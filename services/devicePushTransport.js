'use strict';

const { connect } = require('node:http2');
const { sign } = require('node:crypto');
const { normalizeDestination, lifetimeSeconds, androidPackage } = require('./deviceNoticePolicy');

const fcmScope = 'https://www.googleapis.com/auth/firebase.messaging';
const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const cachedTokens = new Map();
const apnsTokens = new Map();

function credentials(env) {
  try { return JSON.parse(env.DEVICE_PUSH_FCM_SERVICE_ACCOUNT_JSON || 'null'); } catch { return null; }
}
function configured(platform, env = process.env) {
  if (platform === 'web') return Boolean(env.DEVICE_PUSH_VAPID_PUBLIC_KEY && env.DEVICE_PUSH_VAPID_PRIVATE_KEY);
  if (platform === 'android') {
    const fcm = credentials(env);
    return Boolean(/^[a-z][a-z0-9-]{3,62}$/.test(fcm?.project_id || '') && fcm.client_email && fcm.private_key);
  }
  return Boolean(platform === 'ios' && env.DEVICE_PUSH_APNS_KEY_ID && env.DEVICE_PUSH_APNS_TEAM_ID && env.DEVICE_PUSH_APNS_PRIVATE_KEY);
}
function jwt(header, claims, key, algorithm, encoding) {
  const parts = [header, claims].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
  return parts + '.' + sign(algorithm, Buffer.from(parts), encoding ? { key, dsaEncoding: encoding } : key).toString('base64url');
}
async function googleBearer(account, scope, fetcher = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = account.client_email + '|' + scope + '|' + (account.private_key_id || '');
  const cached = cachedTokens.get(cacheKey);
  if (cached?.expiry > now + 60) return cached.token;
  const assertion = jwt({ alg: 'RS256', typ: 'JWT' }, { iss: account.client_email, scope,
    aud: googleTokenUrl, iat: now, exp: now + 3600 }, account.private_key, 'RSA-SHA256');
  const response = await fetcher(googleTokenUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error('Google authentication rejected');
  const data = await response.json();
  if (typeof data.access_token !== 'string') throw new Error('Google authentication response invalid');
  cachedTokens.set(cacheKey, { token: data.access_token, expiry: now + Math.min(Number(data.expires_in) || 0, 3600) });
  return data.access_token;
}
function outcome(status, { dead = false, retry = false } = {}) {
  if (status >= 200 && status < 300) return { status: 'accepted', code: 'HTTP_' + status };
  return { status: retry ? 'retry' : 'failed', code: 'HTTP_' + status, dead };
}
async function sendWeb(destination, payload, env) {
  try {
    const result = await require('web-push').sendNotification(destination, JSON.stringify(payload), {
      TTL: lifetimeSeconds, timeout: 8000, contentEncoding: 'aes128gcm', urgency: 'normal',
      vapidDetails: { subject: 'mailto:info@voxelveda.com', publicKey: env.DEVICE_PUSH_VAPID_PUBLIC_KEY, privateKey: env.DEVICE_PUSH_VAPID_PRIVATE_KEY }
    });
    return outcome(result.statusCode);
  } catch (error) {
    if (Number.isInteger(error.statusCode)) return outcome(error.statusCode, { dead: [404,410].includes(error.statusCode), retry: error.statusCode === 429 });
    return { status: 'uncertain', code: 'WEB_TRANSPORT_UNKNOWN' };
  }
}
async function sendFcm(destination, payload, env, fetcher) {
  const account = credentials(env);
  let bearer;
  try { bearer = await googleBearer(account, fcmScope, fetcher); }
  catch { return { status: 'retry', code: 'FCM_AUTH_UNAVAILABLE' }; }
  try {
    const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: destination.token, data: { kind: payload.kind },
        notification: { title: payload.title, body: payload.body },
        android: { restricted_package_name: androidPackage, ttl: `${lifetimeSeconds}s`, notification: { tag: payload.tag, visibility: 'PRIVATE' } } } })
    });
    const data = response.ok ? null : await response.json().catch(() => null);
    const unregistered = data?.error?.details?.some(item => item?.errorCode === 'UNREGISTERED');
    return outcome(response.status, { dead: Boolean(unregistered), retry: response.status === 429 });
  } catch { return { status: 'uncertain', code: 'FCM_TRANSPORT_UNKNOWN' }; }
}
function sendApns(destination, payload, env) {
  const host = env.DEVICE_PUSH_APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  let bearer;
  try {
    const now = Math.floor(Date.now() / 1000);
    const key = env.DEVICE_PUSH_APNS_TEAM_ID + '/' + env.DEVICE_PUSH_APNS_KEY_ID;
    let cached = apnsTokens.get(key);
    if (!cached || cached.createdAt < now - 3000) {
      cached = { createdAt: now, bearer: jwt({ alg: 'ES256', kid: env.DEVICE_PUSH_APNS_KEY_ID },
        { iss: env.DEVICE_PUSH_APNS_TEAM_ID, iat: now }, env.DEVICE_PUSH_APNS_PRIVATE_KEY.replace(/\\n/g, '\n'), 'sha256', 'ieee-p1363') };
      apnsTokens.set(key, cached);
    }
    bearer = cached.bearer;
  } catch { return Promise.resolve({ status: 'failed', code: 'APNS_KEY_INVALID' }); }
  return new Promise(resolve => {
    const client = connect(host);
    let responseStatus = 0;
    let responseBody = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      resolve(result);
    };
    const unknown = () => finish({ status: 'uncertain', code: 'APNS_TRANSPORT_UNKNOWN' });
    const timer = setTimeout(unknown, 8000);
    client.on('error', unknown);
    const request = client.request({ ':method': 'POST', ':path': '/3/device/' + destination.token,
      authorization: 'bearer ' + bearer, 'apns-topic': androidPackage, 'apns-push-type': 'alert',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + lifetimeSeconds), 'apns-collapse-id': payload.tag });
    request.on('response', headers => { responseStatus = Number(headers[':status']); });
    request.on('error', unknown);
    request.on('data', chunk => { if (responseBody.length < 2048) responseBody += chunk; });
    request.on('end', () => {
      if (!responseStatus) return unknown();
      let reason;
      try { reason = JSON.parse(responseBody).reason; } catch {}
      finish(outcome(responseStatus, { dead: responseStatus === 410 || reason === 'BadDeviceToken', retry: responseStatus === 429 }));
    });
    request.end(JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' }, kind: payload.kind }));
  });
}
async function sendDeviceNotice(platform, raw, payload, env = process.env, fetcher = fetch) {
  const destination = normalizeDestination(platform, raw);
  if (!destination) return { status: 'failed', code: 'DESTINATION_INVALID', dead: true };
  if (!configured(platform, env)) return { status: 'retry', code: 'PROVIDER_UNAVAILABLE' };
  if (platform === 'web') return sendWeb(destination, payload, env);
  if (platform === 'android') return sendFcm(destination, payload, env, fetcher);
  return sendApns(destination, payload, env);
}

module.exports = { configured, googleBearer, sendDeviceNotice };
