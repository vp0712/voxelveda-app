'use strict';

const { createHmac } = require('node:crypto');
const { googleBearer } = require('../services/devicePushTransport');
const { appOrigin, androidPackage, releaseRecord } = require('../services/deviceNoticePolicy');

async function reply(fetcher, url, options = {}) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...options });
  if (!response.ok) throw new Error(`Release verification endpoint returned HTTP ${response.status}.`);
  return response;
}

async function verifyWebCommit(version, fetcher) {
  const response = await reply(fetcher, appOrigin + '/api/ready', { headers: { 'Cache-Control': 'no-cache' } });
  const state = await response.json();
  if (state.ready !== true || state.deployment_sha !== version) throw new Error('Production does not serve the verified revision.');
  return 'production-readiness';
}

async function verifyPlayRelease(version, env, fetcher) {
  let account;
  try { account = JSON.parse(env.DEVICE_RELEASE_PLAY_READER_JSON || 'null'); }
  catch { throw new Error('DEVICE_RELEASE_PLAY_READER_JSON is not valid JSON.'); }
  if (!account?.client_email || !account.private_key) throw new Error('DEVICE_RELEASE_PLAY_READER_JSON is required.');
  const access = await googleBearer(account, 'https://www.googleapis.com/auth/androidpublisher', fetcher);
  const headers = { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' };
  const edits = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${androidPackage}/edits`;
  // Only inspect a fresh edit snapshot. Never commit an edit or change a track.
  const edit = await (await reply(fetcher, edits, { method:'POST', headers, body:'{}' })).json();
  if (!/^[\w-]+$/.test(edit.id || '')) throw new Error('Play did not return a valid edit snapshot.');
  const url = edits + '/' + edit.id;
  try {
    const production = await (await reply(fetcher, url + '/tracks/production', { headers })).json();
    const versionCodes = production.releases?.filter(r => r.status === 'completed')
      .flatMap(r => r.versionCodes || []).map(Number) || [];
    const current = String(Math.max(...versionCodes));
    if (!versionCodes.length || version && current !== version) {
      throw new Error('This build is not the highest completed Play production release.');
    }
    return current;
  } finally {
    await reply(fetcher, url, { method:'DELETE', headers });
  }
}

async function verifyAppleRelease(version, env, fetcher) {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', env.DEVICE_PUSH_APPLE_STORE_ID);
  url.searchParams.set('country', 'au');
  const catalog = await (await reply(fetcher, url.href)).json();
  const listing = catalog.results?.find(item => String(item.trackId) === env.DEVICE_PUSH_APPLE_STORE_ID &&
      item.bundleId === androidPackage && (!version || item.version === version));
  if (!listing) {
    throw new Error('This Voxel Veda version is unavailable in the Australian App Store catalog.');
  }
  return listing.version;
}

async function publishRelease(platform, version, env = process.env, fetcher = fetch) {
  const secret = env.DEVICE_RELEASE_WEBHOOK_SECRET;
  if (!secret) return { skipped: 'DEVICE_RELEASE_WEBHOOK_SECRET is not configured.' };
  if (secret.length < 32) throw new Error('DEVICE_RELEASE_WEBHOOK_SECRET must have at least 32 characters.');
  if ((version || platform === 'web') && !releaseRecord(platform, version, env.DEVICE_PUSH_APPLE_STORE_ID)) throw new Error('Release identity is invalid.');
  let proof;
  if (platform === 'web') proof = await verifyWebCommit(version, fetcher);
  else if (platform === 'android') {
    version = await verifyPlayRelease(version, env, fetcher);
    proof = 'play-production-completed';
  } else if (platform === 'ios') {
    version = await verifyAppleRelease(version, env, fetcher);
    proof = 'app-store-lookup';
  }
  if (!releaseRecord(platform, version, env.DEVICE_PUSH_APPLE_STORE_ID)) throw new Error('Store returned an invalid release identity.');
  const body = JSON.stringify({ platform, version, proof });
  const time = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(time + '.').update(body).digest('hex');
  const response = await reply(fetcher, appOrigin + '/api/device-notices/verified-release', {
    method: 'POST', headers: { 'Content-Type':'application/json', 'X-VV-Release-Time': time,
      'X-VV-Release-Signature':signature }, body });
  return response.json();
}

if (require.main === module) {
  publishRelease(process.argv[2], process.argv[3]).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
module.exports = { publishRelease, verifyPlayRelease, verifyAppleRelease };
