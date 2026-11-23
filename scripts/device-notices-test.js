'use strict';

const assert = require('node:assert/strict');
const { createHmac, createECDH, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');
const { normalizeDestination, verifyProducer, releaseRecord, updateApplies, noticePayload } = require('../services/deviceNoticePolicy');
const { publishRelease } = require('./publish-device-release-notice');

function subscription() {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return { endpoint:'https://fcm.googleapis.com/fcm/send/fixture', keys:{
    p256dh:key.getPublicKey().toString('base64url'), auth:randomBytes(16).toString('base64url') } };
}

async function policyChecks() {
  const good = subscription();
  assert.deepEqual(normalizeDestination('web', good),good);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://user@fcm.googleapis.com/a',
    'https://fcm.googleapis.com.example.invalid/a', 'https://fcm.googleapis.com:777/a','https://voxelveda.com/a']) {
    assert.equal(normalizeDestination('web',{...good,endpoint}),null);
  }
  assert.equal(normalizeDestination('web',{...good,keys:{...good.keys,auth:'invalid'}}),null);
  assert.equal(normalizeDestination('android',{token:'fixture:token_'+'x'.repeat(80)}).token.length,94);
  assert.equal(normalizeDestination('ios',{token:'AB'.repeat(32)}).token,'ab'.repeat(32));
  const secret = 'a'.repeat(64), ts = '1782000000', body = Buffer.from('{"version":"fixture"}');
  const signature = createHmac('sha256',secret).update(ts+'.').update(body).digest('hex');
  assert(verifyProducer(secret,ts,signature,body,Number(ts)*1000));
  assert(!verifyProducer(secret,ts,signature,body,Number(ts)*1000+301000));
  assert(!verifyProducer(secret,ts,signature,Buffer.from('{}'),Number(ts)*1000));
  assert.equal(releaseRecord('android','52').action,'https://play.google.com/store/apps/details?id=com.voxelveda.app');
  assert.equal(releaseRecord('ios','2.8.10','12345678').action,'https://apps.apple.com/app/id12345678');
  assert(!releaseRecord('ios','2.8.10','redirect.invalid'));
  assert(updateApplies('ios','2.8.9','2.8.10'));
  assert(!updateApplies('ios','2.10.0','2.9'));
  assert(!updateApplies('android','52','52'));
  assert.deepEqual(noticePayload('team',7),{kind:'team',title:'Voxel Veda',body:'Voxel Veda activity is ready',tag:'vv-team-7'});
  const liveRevision = 'b'.repeat(40);
  let sent = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('/api/ready')) return Response.json({ready:true,deployment_sha:liveRevision});
    assert.equal(url,'https://app.voxelveda.com/api/device-notices/verified-release');
    assert(verifyProducer(secret,options.headers['X-VV-Release-Time'],options.headers['X-VV-Release-Signature'],Buffer.from(options.body)));
    assert.deepEqual(JSON.parse(options.body),{platform:'web',version:liveRevision,proof:'production-readiness'});
    sent++;
    return Response.json({recorded:true});
  };
  await assert.rejects(publishRelease('web','a'.repeat(40),{DEVICE_RELEASE_WEBHOOK_SECRET:secret}, fetcher), /does not serve/);
  assert.equal(sent,0);
  assert.deepEqual(await publishRelease('web',liveRevision,{DEVICE_RELEASE_WEBHOOK_SECRET:secret},fetcher),{recorded:true});
  assert.equal(sent,1);
}

async function workerChecks() {
  const handlers = new Map(), calls = [], windows = [];
  const self = { location: {origin:'https://app.voxelveda.com'}, addEventListener:(name,handler) => handlers.set(name,handler),
    registration:{showNotification:(...args) => { calls.push(['show', ...args]); }},
    clients:{matchAll:async () => windows,openWindow:async path => calls.push(['open',path])} };
  runInNewContext(readFileSync(join(__dirname,'../public/device-notices-sw.js'),'utf8'),{self,URL});
  assert(!handlers.has('fetch'),'The notification-only worker must never serve cached private HTML.');
  async function event(name, input) {
    let operation;
    handlers.get(name)({...input,waitUntil:value => { operation = value; }});
    await operation;
  }
  await event('push',{data:{json:() => ({kind:'team',title:'private label',body:'sensitive detail',path:'/private/path',tag:'vv-team-7'})}});
  assert.equal(calls[0][2].body,'Voxel Veda activity is ready');
  assert.equal(calls[0][2].data.kind,'team');
  assert.deepEqual(Object.keys(calls[0][2].data),['kind']);
  await event('notificationclick',{notification:{close(){},data:{kind:'team',path:'https://malicious.invalid/'}}});
  assert.deepEqual(calls.at(-1),['open','/dashboard?team_activity=1']);
  await event('notificationclick',{notification:{close(){},data:{kind:'release'}}});
  assert.deepEqual(calls.at(-1),['open','/updates']);
  windows.push({url:'https://app.voxelveda.com/invoices',focus:async () => calls.push(['focus']),postMessage:message => calls.push(['message',message])});
  await event('notificationclick',{notification:{close(){},data:{kind:'team'}}});
  assert.equal(calls.at(-1)[1].kind,'team');
  assert.deepEqual(calls.at(-2),['focus']);
}

async function nativeBridgeChecks() {
  const hooks = new Map();
  const plugin = {
    addListener: async (name, fn) => hooks.set(name,fn),
    checkPermissions: async () => ({receive:'denied'}),
    requestPermissions: async () => ({receive:'granted'}),
    register: async () => hooks.get('registration')({value:'fixture-device-token'}),
    unregister: async () => {}
  };
  const window = { Capacitor: { isNativePlatform:() => true, getPlatform:() => 'android', isPluginAvailable:() => true,
    Plugins:{ PushNotifications:plugin,VoxelVedaApp:{getAppInfo:async () => ({versionName:'2.1',versionCode:40,pushConfigured:true})} } } };
  runInNewContext(readFileSync(join(__dirname,'../public/native-device-push.js'),'utf8'),{
    window,location:{origin:'https://app.voxelveda.com'},setTimeout,clearTimeout });
  const bridge = window.VVNativeDevicePush;
  assert.equal((await bridge.info()).build,40);
  assert.equal(await bridge.permission(),'denied');
  assert.equal(await bridge.request(),'granted');
  assert.equal((await bridge.register()).token,'fixture-device-token');
  hooks.get('pushNotificationActionPerformed')({actionId:'tap',notification:{data:{kind:'team',url:'https://example.invalid'}}});
  const seen = [];
  bridge.onTap(notice => seen.push(notice.kind));
  hooks.get('pushNotificationActionPerformed')({actionId:'tap',notification:{data:{kind:'release'}}});
  hooks.get('pushNotificationActionPerformed')({actionId:'dismiss',notification:{data:{kind:'team'}}});
  hooks.get('pushNotificationActionPerformed')({actionId:'tap',notification:{data:{kind:'unsafe'}}});
  assert.deepEqual(seen,['team','release']);
  console.log('Device-notice policy, browser worker, and native bridge fixtures passed: production gate, signature, private content, permission, registration, and cold/warm routing.');
}

policyChecks().then(workerChecks).then(nativeBridgeChecks).catch(error => { console.error(error); process.exitCode = 1; });
