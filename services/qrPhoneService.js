'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const { activeEmployee } = require('./weeklyTimesheetEligibility');
const { hasPermission, parsePermissions } = require('./authorizationService');
const { siteId } = require('./attendanceQrService');

const LINK_SECONDS = 10 * 60;
const DEVICE_SECONDS = 30 * 24 * 60 * 60;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE = /^[0-9a-f]{64}$/;

const CREATE = `CREATE TABLE IF NOT EXISTS attendance_phone_links (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  session_version BIGINT NOT NULL,
  site_id VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  challenge CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  credential_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  linked_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_qr_phone_challenge (challenge),
  UNIQUE KEY uq_qr_phone_code (code_hash),
  UNIQUE KEY uq_qr_phone_credential (credential_hash),
  KEY ix_qr_phone_owner (user_id, expires_at)
) ENGINE=InnoDB`;

const userFields = 'u.id, u.name, u.username, u.role, u.permissions, u.employee_number, u.active, u.deleted_at, u.account_status, u.session_version';
const schemas = new WeakMap();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function unlinked() {
  return failure(401, 'QR_PHONE_UNLINKED', 'This phone is not linked to an active staff account. Link your phone again.');
}

function invalidHandoff() {
  return failure(400, 'QR_PHONE_LINK_INVALID', 'This link expired or does not belong to this browser. Start phone linking again.');
}

function isSecret(value) {
  return typeof value === 'string' && value.length === 43 && SECRET.test(value);
}

function begin() {
  const verifier = randomSecret();
  return { verifier, challenge: digest(verifier) };
}

function ensureSchema(db) {
  if (!schemas.has(db)) {
    const result = db.query(CREATE).catch(error => {
      schemas.delete(db);
      throw error;
    });
    schemas.set(db, result);
  }
  return schemas.get(db);
}

async function transaction(db, operation) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function canLink(user) {
  return activeEmployee(user) && hasPermission(user, 'VIEW_ATTENDANCE') &&
    user.session_version != null && Number.isSafeInteger(Number(user.session_version));
}

function staffIdentity(user) {
  return {
    id: user.id, name: user.name, username: user.username,
    role: String(user.role || '').trim().toLowerCase(),
    permissions: parsePermissions(user.permissions),
    permission_boundary: ['VIEW_ATTENDANCE']
  };
}

async function lockAccount(db, id) {
  const [[row]] = await db.query(`SELECT ${userFields} FROM users u WHERE u.id=? FOR UPDATE`, [id]);
  return row;
}

async function issueHandoff({ userId, challenge }, db = pool) {
  if (typeof challenge !== 'string' || challenge.length !== 64 || !CHALLENGE.test(challenge)) throw invalidHandoff();
  await ensureSchema(db);
  return transaction(db, async connection => {
    const staff = await lockAccount(connection, userId);
    if (!canLink(staff)) throw failure(403, 'QR_PHONE_INELIGIBLE', 'An active staff account with attendance access is required.');
    // Expired pending handoffs hold no attendance history. Bound cleanup to the issuing user.
    await connection.query('DELETE FROM attendance_phone_links WHERE user_id=? AND linked_at IS NULL AND expires_at<=UTC_TIMESTAMP(3)', [userId]);
    const code = randomSecret();
    try {
      await connection.query(`
        INSERT INTO attendance_phone_links
          (id,user_id,session_version,site_id,challenge,code_hash,created_at,expires_at)
        VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3),TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)))
      `, [crypto.randomUUID(), userId, staff.session_version, siteId(), challenge, digest(code), LINK_SECONDS]);
    } catch (error) {
      // Another tab, retry or account already used this browser challenge.
      if (error.code === 'ER_DUP_ENTRY') throw invalidHandoff();
      throw error;
    }
    return { code };
  });
}

async function redeem({ code, verifier }, db = pool) {
  if (!isSecret(code) || !isSecret(verifier)) throw invalidHandoff();
  await ensureSchema(db);
  const codeHash = digest(code);
  const challenge = digest(verifier);
  // This first read only identifies the lock order. The conditional UPDATE below is authoritative.
  const [[pending]] = await db.query(
    'SELECT id,user_id FROM attendance_phone_links WHERE code_hash=? AND challenge=?',
    [codeHash, challenge]
  );
  if (!pending) throw invalidHandoff();

  return transaction(db, async connection => {
    const staff = await lockAccount(connection, pending.user_id);
    if (!canLink(staff)) throw invalidHandoff();
    const credential = randomSecret();
    const [updated] = await connection.query(`
      UPDATE attendance_phone_links
      SET code_hash=NULL, credential_hash=?, linked_at=UTC_TIMESTAMP(3),
          expires_at=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))
      WHERE id=? AND user_id=? AND code_hash=? AND challenge=? AND site_id=? AND session_version=?
        AND linked_at IS NULL AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
    `, [digest(credential), DEVICE_SECONDS, pending.id, staff.id, codeHash, challenge, siteId(), staff.session_version]);
    if (updated.affectedRows !== 1) throw invalidHandoff();
    return { credential, deviceId: pending.id };
  });
}

async function verify(credential, db = pool) {
  if (!isSecret(credential)) throw unlinked();
  await ensureSchema(db);
  const [[row]] = await db.query(`
    SELECT ${userFields}, p.id AS device_id
    FROM attendance_phone_links p JOIN users u ON u.id=p.user_id
    WHERE p.credential_hash=? AND p.site_id=? AND p.linked_at IS NOT NULL
      AND p.revoked_at IS NULL AND p.expires_at>UTC_TIMESTAMP(3) AND p.session_version=u.session_version
  `, [digest(credential), siteId()]);
  if (!canLink(row)) throw unlinked();
  return { user: staffIdentity(row), deviceId: row.device_id };
}

// The attendance writer already locks this user. Lock the device on the same
// connection so revocation and a time punch have a definitive commit order.
async function authorizeAction(connection, userId, deviceId) {
  if (typeof deviceId !== 'string' || deviceId.length !== 36) throw unlinked();
  const [[row]] = await connection.query(`
    SELECT ${userFields}
    FROM attendance_phone_links p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.user_id=? AND p.site_id=? AND p.credential_hash IS NOT NULL
      AND p.linked_at IS NOT NULL AND p.revoked_at IS NULL AND p.expires_at>UTC_TIMESTAMP(3)
      AND p.session_version=u.session_version
    FOR UPDATE
  `, [deviceId, userId, siteId()]);
  if (!canLink(row)) throw unlinked();
}

async function revoke(credential, db = pool) {
  if (!isSecret(credential)) return;
  await ensureSchema(db);
  await db.query(`
    UPDATE attendance_phone_links SET revoked_at=UTC_TIMESTAMP(3), credential_hash=NULL
    WHERE credential_hash=? AND revoked_at IS NULL
  `, [digest(credential)]);
}

async function revokeAll(userId, db = pool) {
  await ensureSchema(db);
  return transaction(db, async connection => {
    // Serialize with issue and redeem. Invalidate pending approvals as well as linked phones.
    const account = await lockAccount(connection, userId);
    if (!account) throw unlinked();
    const [updated] = await connection.query(`
      UPDATE attendance_phone_links SET revoked_at=UTC_TIMESTAMP(3),code_hash=NULL,credential_hash=NULL
      WHERE user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
    `, [userId]);
    return { revoked: updated.affectedRows };
  });
}

module.exports = { begin, issueHandoff, redeem, verify, authorizeAction, revoke, revokeAll, LINK_SECONDS, DEVICE_SECONDS };
