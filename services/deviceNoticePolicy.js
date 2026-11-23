'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const platforms = ['web', 'android', 'ios'];
const lifetimeSeconds = 3600;
const appOrigin = 'https://app.voxelveda.com';
const androidPackage = 'com.voxelveda.app';
const publicPath = '/updates';
const teamPath = '/dashboard?team_activity=1';
const webPushHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com',
  'push.services.mozilla.com', 'web.push.apple.com']);

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function validBase64Url(value, size) {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === size && decoded.toString('base64url') === value;
}
function normalizeDestination(platform, input) {
  if (platform === 'web') {
    if (typeof input?.endpoint !== 'string' || input.endpoint.length > 1800) return null;
    let url;
    try { url = new URL(input.endpoint); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !webPushHosts.has(url.hostname) || url.pathname === '/' ||
      !validBase64Url(input.keys?.p256dh, 65) || !validBase64Url(input.keys?.auth, 16) ||
      Buffer.from(input.keys.p256dh, 'base64url')[0] !== 4) return null;
    return { endpoint: url.href, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
  }
  if (platform === 'android' && /^[a-zA-Z0-9:_-]{30,512}$/.test(input?.token || '')) {
    return { token: input.token };
  }
  if (platform === 'ios' && /^[0-9a-fA-F]{32,256}$/.test(input?.token || '') && input.token.length % 2 === 0) {
    return { token: input.token.toLowerCase() };
  }
  return null;
}
function verifyProducer(secret, timestamp, signature, body, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !Buffer.isBuffer(body)) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
function releaseRecord(platform, version, storeId) {
  if (typeof version !== 'string' || version.length > 50 || !platforms.includes(platform)) return null;
  if (platform === 'web' && /^[a-f0-9]{40}$/.test(version)) {
    return { platform, version, key: version, action: publicPath };
  }
  if (platform === 'android' && /^[1-9]\d{0,9}$/.test(version)) {
    return { platform, version, key: version, action: `https://play.google.com/store/apps/details?id=${androidPackage}` };
  }
  if (platform === 'ios' && /^\d{1,5}(\.\d{1,5}){0,3}$/.test(version) && /^[1-9]\d{5,14}$/.test(storeId || '')) {
    return { platform, version, key: version, action: `https://apps.apple.com/app/id${storeId}` };
  }
  return null;
}
function updateApplies(platform, installed, release) {
  if (platform === 'web') return true;
  if (typeof installed !== 'string' || !/^\d{1,10}(\.\d{1,5}){0,3}$/.test(installed)) return false;
  const left = installed.split('.').map(Number);
  const right = release.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

function noticePayload(kind, id) {
  if (kind === 'team') return { kind, title: 'Voxel Veda', body: 'Voxel Veda activity is ready', tag: 'vv-team-' + id };
  return { kind: 'release', title: 'Voxel Veda', body: 'An app update is available', tag: 'vv-release-' + id };
}

module.exports = { platforms, appOrigin, androidPackage, publicPath, teamPath, lifetimeSeconds,
  sha, validBase64Url, normalizeDestination, verifyProducer, releaseRecord, updateApplies, noticePayload };
