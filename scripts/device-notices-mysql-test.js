'use strict';

const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createECDH } = require('node:crypto');
if (process.env.REPAIR_DB_TEST !== 'true' || process.env.DB_NAME !== 'voxelveda_repair_test' ||
    !['127.0.0.1','localhost','::1','mysql'].includes(process.env.DB_HOST)) {
  throw new Error('Run only after retained-mysql-test with its disposable local database.');
}
const pool = require('../config/db');
const notices = require('../services/deviceNoticeService');
const { sha, releaseRecord } = require('../services/deviceNoticePolicy');
const { eventFromGitHub, recordAiTeamEvent } = require('../services/aiTeamService');
const ids = { personal: 971301, shared: 971302 };
const env = { DEVICE_PUSH_VAPID_PUBLIC_KEY: 'local-transport-fixture', DEVICE_PUSH_VAPID_PRIVATE_KEY: 'local-transport-fixture',
  AI_TEAM_RECIPIENT_USER_IDS: String(ids.personal), AI_TEAM_GITHUB_REPOSITORY_ID: '7101' };

function device() {
  const key = createECDH('prime256v1');
  key.generateKeys();
  const id = randomUUID();
  return { credential: { id, hash: sha(randomBytes(32)) }, destination: { endpoint:'https://fcm.googleapis.com/fcm/send/' + id,
    keys:{ p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url') } } };
}

async function main() {
  const [[identity]] = await pool.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'voxelveda_repair_test');
  const anonymous = device(), personal = device(), switched = device(), denied = device();
  for (const entry of [anonymous, personal, switched, denied]) {
    await notices.saveDevice(entry.credential,{ platform:'web',destination:entry.destination,
      releaseOptIn:entry !== denied,installedVersion:null });
  }
  await pool.query(`INSERT INTO users (id,username,email,password,role,active,account_status,session_version)
    VALUES (?,?,?,?, 'admin',1,'ACTIVE',1)`,[ids.personal,'notice-fixture','notice-fixture@example.invalid','disposable-fixture']);
  const sessionId = randomUUID();
  async function session(id) {
    await pool.query(`INSERT INTO auth_sessions (id,user_id,token_hash,assurance_level,session_version,expires_at)
      VALUES (?,?,?,2,1,DATE_SUB(NOW(), INTERVAL 1 MINUTE))`,[id,ids.personal,sha(id)]);
    return { user:{id:ids.personal},session:{id} };
  }
  const req = await session(sessionId);
  assert(await notices.bindDevice(personal.credential,req,true));
  assert(await notices.bindDevice(switched.credential,req,false));
  await notices.reconcileBinding(switched.credential,ids.shared);
  assert.equal((await notices.findDevice(switched.credential)).owner_id,null);
  await pool.query(`INSERT INTO ai_team_preferences (user_id,in_app_enabled,push_enabled,push_enabled_at)
    VALUES (?,1,1,UTC_TIMESTAMP(3))`,[ids.personal]);
  const record = releaseRecord('web','c'.repeat(40));
  assert(await notices.recordRelease(record));
  assert.equal(await notices.recordRelease(record),false);
  function event(run) {
    return eventFromGitHub('workflow_run',{ repository:{id:7101,full_name:'vp0712/voxelveda-app'},action:'completed',
      workflow_run:{id:run,run_attempt:1,name:'Test security review',status:'completed',conclusion:'success'} },env);
  }
  assert((await recordAiTeamEvent(pool,event(55001),env)).recorded);
  assert.equal((await recordAiTeamEvent(pool,event(55001),env)).recorded,false);
  const deliveries = [];
  const send = async (platform,destination,payload) => {
    deliveries.push({platform,endpoint:destination.endpoint,payload});
    return {status:'accepted',code:'TEST_ACCEPTED'};
  };
  await Promise.all([notices.dispatchDeviceNotices(env,send),notices.dispatchDeviceNotices(env,send)]);
  assert.equal(deliveries.filter(x => x.payload.kind === 'release').length,3);
  const [firstTeam] = deliveries.filter(x => x.payload.kind === 'team');
  assert.equal(deliveries.filter(x => x.payload.kind === 'team').length,1);
  assert.equal(firstTeam.endpoint,personal.destination.endpoint);
  assert.equal(firstTeam.payload.body,'Voxel Veda activity is ready');
  assert(!JSON.stringify(firstTeam.payload).includes('Test security review'));
  assert(deliveries.some(x => x.endpoint === anonymous.destination.endpoint && x.payload.kind === 'release'));
  assert(!deliveries.some(x => x.endpoint === denied.destination.endpoint));

  await pool.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='LOGOUT' WHERE id=?",[sessionId]);
  await notices.onLogout(req);
  assert(await notices.recordRelease(releaseRecord('web','d'.repeat(40))));
  assert((await recordAiTeamEvent(pool,event(55002),env)).recorded);
  await notices.dispatchDeviceNotices(env,send);
  assert.equal(deliveries.filter(x => x.payload.kind === 'release').length,6);
  assert.equal(deliveries.filter(x => x.payload.kind === 'team').length,2);
  const newSession = randomUUID();
  await session(newSession);
  await notices.reattachBinding(personal.credential,ids.personal,newSession);
  await pool.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='TEST_REVOKED' WHERE id=?",[newSession]);
  assert((await recordAiTeamEvent(pool,event(55003),env)).recorded);
  await notices.dispatchDeviceNotices(env,send);
  assert.equal(deliveries.filter(x => x.payload.kind === 'team').length,2);
  await notices.unlinkDevice(personal.credential);
  assert.equal((await notices.findDevice(personal.credential)).owner_id,null);
  assert.equal((await notices.findDevice(personal.credential)).release_opt_in,1);

  const previous = await notices.findDevice(personal.credential);
  await notices.optOutOfReleases(personal.credential);
  const replacement = device().destination;
  assert.equal(await notices.rotateDestination(personal.credential, previous.destination_hash,
    {platform:'web',destination:replacement,installedVersion:null}),false,
  'A second tab cannot rotate or restore an opted-out destination from an earlier read');
  let stopped = await notices.findDevice(personal.credential);
  assert.equal(stopped.release_opt_in,0);
  assert.equal(stopped.destination_hash,null);

  const linked = device();
  await notices.saveDevice(linked.credential,{platform:'web',destination:linked.destination,releaseOptIn:true,installedVersion:null});
  assert(await notices.bindDevice(linked.credential,await session(randomUUID()),false));
  await notices.optOutOfReleases(linked.credential);
  const teamOnly = await notices.findDevice(linked.credential);
  assert.equal(teamOnly.owner_id,ids.personal);
  assert.equal(teamOnly.release_opt_in,0);
  assert(teamOnly.destination_hash);
  await notices.saveDevice(linked.credential,{platform:'web',destination:linked.destination,installedVersion:null});
  assert.equal((await notices.findDevice(linked.credential)).release_opt_in,0,'Updating only team enrollment preserves the public choice');
  assert(await notices.rotateDestination(linked.credential,teamOnly.destination_hash,
    {platform:'web',destination:replacement,installedVersion:null}));
  assert.equal(await notices.disableDestination(linked.credential,teamOnly.destination_hash,'web'),false,
    'A stale browser permission response cannot clear a newer destination');
  await notices.unlinkDevice(linked.credential);
  stopped = await notices.findDevice(linked.credential);
  assert.equal(stopped.owner_id,null);
  assert.equal(stopped.destination_hash,null);
  console.log('Real MySQL verified persistent opt-in, release and team retries, concurrent claims, expiry, explicit logout retention, account switch, session revocation and unsubscribe/rotation ordering. Provider simulated.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
