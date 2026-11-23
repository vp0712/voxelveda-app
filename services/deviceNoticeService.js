'use strict';

const db = require('../config/db');
const { randomUUID } = require('node:crypto');
const { activeAuthorization, eligibleIds } = require('./deviceNoticeTeamAccess');
const { configured, sendDeviceNotice } = require('./devicePushTransport');
const { sha, validBase64Url, normalizeDestination, noticePayload, updateApplies } = require('./deviceNoticePolicy');

const installationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const staleAfterDays = 120;
const clearBinding = 'owner_id=NULL,owner_session_version=NULL,owner_session_id=NULL,retain_after_logout=0,bound_at=NULL';
const liveUser = "u.active=1 AND u.deleted_at IS NULL AND UPPER(COALESCE(u.account_status,'')) NOT IN ('LOCKED','SUSPENDED','DISABLED','TERMINATED') AND LOWER(u.role) IN ('admin','super_admin')";

function deviceKey(req) {
  const id = req.headers['x-vv-installation'];
  const secret = req.headers['x-vv-installation-key'];
  return installationId.test(id || '') && validBase64Url(secret, 32) ? { id, hash: sha(secret) } : null;
}
function destinationFingerprint(platform, destination) {
  return sha(platform + ':' + (destination.endpoint || destination.token));
}
function parseDestination(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
async function findDevice(key) {
  const [[device]] = await db.query(`SELECT id,platform,release_opt_in,owner_id,retain_after_logout,destination_hash,installed_version
    FROM notice_installations WHERE id=? AND secret_hash=?`, [key.id, key.hash]);
  return device;
}
async function saveDevice(key, { platform, destination, releaseOptIn, installedVersion }) {
  const fingerprint = destination ? destinationFingerprint(platform, destination) : null;
  const prior = await findDevice(key);
  if (prior) {
    if (prior.platform !== platform) return null;
    const clear = destination ? '' : ',' + clearBinding;
    await db.query(`UPDATE notice_installations SET destination_hash=?,destination=?,installed_version=?${clear},
      opted_in_at=CASE WHEN ?=1 AND release_opt_in=0 THEN UTC_TIMESTAMP(3) WHEN ?=0 THEN NULL ELSE opted_in_at END,
      release_opt_in=COALESCE(?,release_opt_in),last_seen_at=UTC_TIMESTAMP(3)
      WHERE id=? AND secret_hash=?`, [fingerprint, destination && JSON.stringify(destination), installedVersion,
      releaseOptIn ?? null, releaseOptIn ?? null, releaseOptIn ?? null, key.id, key.hash]);
  } else {
    await db.query(`INSERT INTO notice_installations (id,secret_hash,platform,destination_hash,destination,
      installed_version,release_opt_in,opted_in_at,last_seen_at) VALUES (?,?,?,?,?,?,?,IF(?=1,UTC_TIMESTAMP(3),NULL),UTC_TIMESTAMP(3))`,
    [key.id, key.hash, platform, fingerprint, destination && JSON.stringify(destination), installedVersion, Boolean(releaseOptIn), Boolean(releaseOptIn)]);
  }
  return findDevice(key);
}
async function rotateDestination(key, expectedHash, { platform, destination, installedVersion }) {
  const [result] = await db.query(`UPDATE notice_installations SET destination_hash=?,destination=?,
    installed_version=COALESCE(?,installed_version),last_seen_at=UTC_TIMESTAMP(3)
    WHERE id=? AND secret_hash=? AND platform=? AND destination_hash=? AND (release_opt_in=1 OR owner_id IS NOT NULL)`,
  [destinationFingerprint(platform, destination), JSON.stringify(destination), installedVersion, key.id, key.hash, platform, expectedHash]);
  return result.affectedRows > 0;
}
async function disableDestination(key, expectedHash, platform) {
  const [result] = await db.query(`UPDATE notice_installations SET ${clearBinding},destination_hash=NULL,destination=NULL,
    release_opt_in=0,opted_in_at=NULL WHERE id=? AND secret_hash=? AND platform=? AND destination_hash=?`,
  [key.id, key.hash, platform, expectedHash]);
  return result.affectedRows > 0;
}
async function optOutOfReleases(key) {
  await db.query(`UPDATE notice_installations SET release_opt_in=0,opted_in_at=NULL,
    destination_hash=IF(owner_id IS NULL,NULL,destination_hash),destination=IF(owner_id IS NULL,NULL,destination)
    WHERE id=? AND secret_hash=?`, [key.id, key.hash]);
}
async function reconcileBinding(key, actorId) {
  await db.query(`UPDATE notice_installations SET ${clearBinding}
    WHERE id=? AND secret_hash=? AND owner_id<>?`, [key.id, key.hash, actorId]);
}
async function reattachBinding(key, userId, sessionId) {
  await db.query(`UPDATE notice_installations d JOIN users u ON u.id=d.owner_id
    LEFT JOIN auth_sessions s ON s.id=d.owner_session_id
    SET d.owner_session_id=? WHERE d.id=? AND d.secret_hash=? AND d.owner_id=?
    AND d.owner_session_version=u.session_version AND ${liveUser}
    AND (d.owner_session_id IS NULL AND d.retain_after_logout=1 OR s.id IS NOT NULL
      AND s.revoked_at IS NULL AND s.user_id=d.owner_id AND s.session_version=u.session_version)`,
  [sessionId, key.id, key.hash, userId]);
}
async function onSignIn(req, actorId) {
  const key = deviceKey(req);
  if (!key) return;
  try { await reconcileBinding(key, actorId); }
  catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') console.warn('Device notice account switch cleanup failed', error.code || 'NOTICE_STORAGE_ERROR');
  }
}
async function bindDevice(key, req, keep) {
  const [[identity]] = await db.query(`SELECT u.session_version FROM users u
    WHERE u.id=? AND ${liveUser}`, [req.user.id]);
  if (!identity) return false;
  const [result] = await db.query(`UPDATE notice_installations SET
      bound_at=IF(owner_id=? AND bound_at IS NOT NULL,bound_at,UTC_TIMESTAMP(3)),owner_id=?,
      owner_session_version=?,owner_session_id=?,retain_after_logout=?,last_seen_at=UTC_TIMESTAMP(3)
    WHERE id=? AND secret_hash=? AND destination_hash IS NOT NULL`,
  [req.user.id, req.user.id, identity.session_version, req.session.id, keep, key.id, key.hash]);
  return result.affectedRows > 0;
}
async function unlinkDevice(key) {
  await db.query(`UPDATE notice_installations SET ${clearBinding},destination_hash=IF(release_opt_in=0,NULL,destination_hash),
    destination=IF(release_opt_in=0,NULL,destination) WHERE id=? AND secret_hash=?`, [key.id, key.hash]);
}
async function onLogout(req, { all = false } = {}) {
  if (!req.user?.id || (!all && !req.session?.id)) return;
  try {
    if (all) {
      await db.query(`UPDATE notice_installations SET ${clearBinding} WHERE owner_id=?`, [req.user.id]);
      return;
    }
    await db.query(`UPDATE notice_installations SET ${clearBinding}
      WHERE owner_session_id=? AND owner_id=? AND retain_after_logout=0`, [req.session.id, req.user.id]);
    // Detach only the specially opted-in binding. An expired, revoked or
    // rotated account still fails the live authorization/version check.
    await db.query(`UPDATE notice_installations SET owner_session_id=NULL
      WHERE owner_session_id=? AND owner_id=? AND retain_after_logout=1`, [req.session.id, req.user.id]);
  } catch (error) {
    if (error?.code !== 'ER_NO_SUCH_TABLE') console.warn('Device notice logout cleanup failed', error.code || 'NOTICE_STORAGE_ERROR');
  }
}
async function latestRelease(platform) {
  const [[release]] = await db.query('SELECT id,version,action_url,verified_at FROM notice_releases WHERE platform=? ORDER BY id DESC LIMIT 1', [platform]);
  return release || null;
}
async function recordRelease(release) {
  const [result] = await db.query(`INSERT IGNORE INTO notice_releases (platform,release_key,version,action_url) VALUES (?,?,?,?)`,
    [release.platform, release.key, release.version, release.action]);
  return result.affectedRows === 1;
}

const validTeam = `d.owner_session_version=u.session_version AND ${liveUser}
  AND (d.owner_session_id IS NULL AND d.retain_after_logout=1 OR s.id IS NOT NULL AND s.revoked_at IS NULL
    AND s.user_id=d.owner_id AND s.session_version=u.session_version)`;
const teamJoins = `JOIN users u ON u.id=d.owner_id LEFT JOIN auth_sessions s ON s.id=d.owner_session_id
  JOIN ai_team_preferences p ON p.user_id=u.id AND p.push_enabled=1
  JOIN ai_team_recipients r ON r.user_id=u.id`;

async function materialize(platforms, ids) {
  const platformList = platforms.map(() => '?').join(',');
  await db.query(`INSERT IGNORE INTO notice_deliveries (installation_id,kind,source_id)
    SELECT d.id,'release',r.id FROM notice_installations d JOIN notice_releases r ON r.platform=d.platform
    LEFT JOIN notice_deliveries q ON q.installation_id=d.id AND q.kind='release' AND q.source_id=r.id
    WHERE d.platform IN (${platformList}) AND d.release_opt_in=1 AND d.destination_hash IS NOT NULL
      AND d.last_seen_at>=UTC_TIMESTAMP()-INTERVAL ${staleAfterDays} DAY
      AND r.verified_at>=d.opted_in_at AND r.verified_at>=UTC_TIMESTAMP()-INTERVAL 7 DAY AND q.installation_id IS NULL
    ORDER BY r.id,d.id LIMIT 100`, platforms);
  if (!ids.length) return;
  await db.query(`INSERT IGNORE INTO notice_deliveries (installation_id,kind,source_id)
    SELECT d.id,'team',r.event_id FROM notice_installations d ${teamJoins}
    LEFT JOIN notice_deliveries q ON q.installation_id=d.id AND q.kind='team' AND q.source_id=r.event_id
    WHERE d.platform IN (${platformList}) AND d.owner_id IN (${ids.map(() => '?').join(',')}) AND ${validTeam}
      AND d.destination_hash IS NOT NULL AND d.last_seen_at>=UTC_TIMESTAMP()-INTERVAL ${staleAfterDays} DAY
      AND r.created_at>=d.bound_at AND r.created_at>=p.push_enabled_at
      AND r.created_at>=UTC_TIMESTAMP()-INTERVAL 1 DAY AND q.installation_id IS NULL
    ORDER BY r.event_id,d.id LIMIT 100`, [...platforms, ...ids]);
}
async function verifyCandidate(row, ids) {
  const [rows] = await db.query(`SELECT d.* FROM notice_installations d WHERE d.id=? AND d.destination_hash IS NOT NULL
    AND d.last_seen_at>=UTC_TIMESTAMP()-INTERVAL ${staleAfterDays} DAY`, [row.installation_id]);
  const device = rows[0];
  if (!device) return null;
  if (row.kind === 'release') {
    const [[release]] = await db.query(`SELECT platform,version,verified_at FROM notice_releases WHERE id=? AND platform=?
      AND id=(SELECT MAX(id) FROM notice_releases WHERE platform=?)`, [row.source_id, device.platform, device.platform]);
    return release && device.release_opt_in && device.opted_in_at <= release.verified_at &&
      updateApplies(device.platform, device.installed_version, release.version) ? device : null;
  }
  if (!ids.includes(Number(device.owner_id))) return null;
  const [[allowed]] = await db.query(`SELECT d.id FROM notice_installations d ${teamJoins}
    WHERE d.id=? AND d.destination_hash=? AND r.event_id=? AND r.read_at IS NULL AND ${validTeam}
      AND r.created_at>=d.bound_at AND r.created_at>=p.push_enabled_at`, [device.id, device.destination_hash, row.source_id]);
  return allowed ? device : null;
}
async function dispatchDeviceNotices(env = process.env, send = sendDeviceNotice) {
  const enabled = ['web', 'android', 'ios'].filter(platform => configured(platform, env));
  if (!enabled.length) return;
  const ids = eligibleIds(env);
  await db.query(`UPDATE notice_installations SET ${clearBinding},destination_hash=NULL,destination=NULL,
    release_opt_in=0,opted_in_at=NULL WHERE destination_hash IS NOT NULL
    AND last_seen_at<UTC_TIMESTAMP()-INTERVAL ${staleAfterDays} DAY LIMIT 100`);
  await db.query(`UPDATE notice_deliveries SET status='uncertain',provider_code='CLAIM_EXPIRED'
    WHERE status='sending' AND claim_at<UTC_TIMESTAMP()-INTERVAL 5 MINUTE LIMIT 100`);
  await materialize(enabled, ids);
  const [rows] = await db.query(`SELECT installation_id,kind,source_id,attempts FROM notice_deliveries
    WHERE status='queued' AND next_attempt_at<=UTC_TIMESTAMP(3) ORDER BY next_attempt_at LIMIT 12`);
  for (const row of rows) {
    const key = [row.installation_id, row.kind, row.source_id];
    const claim = randomUUID();
    const [claimed] = await db.query(`UPDATE notice_deliveries SET status='sending',claim_id=?,claim_at=UTC_TIMESTAMP(3),attempts=attempts+1
      WHERE installation_id=? AND kind=? AND source_id=? AND status='queued' AND next_attempt_at<=UTC_TIMESTAMP(3)`, [claim, ...key]);
    if (!claimed.affectedRows) continue;
    const device = await verifyCandidate(row, ids);
    if (device && !enabled.includes(device.platform)) {
      await db.query("UPDATE notice_deliveries SET status='queued',next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE),attempts=attempts-1 WHERE installation_id=? AND kind=? AND source_id=? AND claim_id=?", [...key, claim]);
      continue;
    }
    const result = device ? await send(device.platform, parseDestination(device.destination), noticePayload(row.kind, row.source_id), env) :
      { status: 'skipped', code: 'NO_LONGER_ELIGIBLE' };
    const status = result.status === 'retry' ? (row.attempts < 3 ? 'queued' : 'failed') : result.status;
    await db.query(`UPDATE notice_deliveries SET status=?,provider_code=?,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND)
      WHERE installation_id=? AND kind=? AND source_id=? AND claim_id=? AND status='sending'`,
    [status, result.code, 60 * (2 ** row.attempts), ...key, claim]);
    if (result.dead) await db.query(`UPDATE notice_installations SET ${clearBinding},destination_hash=NULL,destination=NULL,
      release_opt_in=0,opted_in_at=NULL WHERE id=? AND destination_hash=?`, [device.id, device.destination_hash]);
  }
}
let timer;
let inflight;
function startDeviceNoticeWorker() {
  if (timer || process.env.DEVICE_PUSH_WORKER_ENABLED !== 'true') return false;
  timer = setInterval(() => {
    if (inflight) return;
    inflight = dispatchDeviceNotices().catch(error => console.warn('Device notice worker', error.code || 'NOTICE_WORKER_ERROR'))
      .finally(() => { inflight = null; });
  }, 30000);
  timer.unref();
  return true;
}
async function stopDeviceNoticeWorker() { clearInterval(timer); timer = null; await inflight; }

module.exports = { deviceKey, findDevice, saveDevice, rotateDestination, disableDestination, optOutOfReleases,
  activeAuthorization, reconcileBinding, reattachBinding, bindDevice, unlinkDevice, onSignIn, onLogout,
  latestRelease, recordRelease, dispatchDeviceNotices, startDeviceNoticeWorker, stopDeviceNoticeWorker };
