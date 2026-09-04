const crypto = require('crypto');
const pool = require('../config/db');
const { ensureSecuritySchema } = require('./securitySchema');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin', 'finance_admin', 'accountant', 'hr']);

function encryptionKey() {
  const raw = String(process.env.MFA_ENCRYPTION_KEY || '').trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
  return key;
}

function keyedHash(value) {
  return crypto.createHmac('sha256', encryptionKey()).update(String(value)).digest('hex');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [iv, tag, encrypted] = String(value || '').split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv?.length || !tag?.length || !encrypted?.length) throw new Error('Invalid encrypted MFA secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) output += ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

function base32Decode(value) {
  const clean = String(value).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 value');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, '0');
}

function verifyTotp(secret, supplied) {
  const code = String(supplied || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => crypto.timingSafeEqual(Buffer.from(totp(secret, Date.now() + window * 30000)), Buffer.from(code)));
}

function matchingTotpStep(secret, supplied) {
  const code = String(supplied || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    const expected = totp(secret, step * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

function requiresMfa(role) {
  const configured = String(process.env.MFA_REQUIRED_ROLES || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return (configured.length ? new Set(configured) : PRIVILEGED_ROLES).has(String(role || '').toLowerCase());
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = (crypto.randomBytes(8).readBigUInt64BE() % 10000000000000000n).toString().padStart(16, '0');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

async function replaceRecoveryCodes(connection, userId) {
  const codes = createRecoveryCodes();
  await connection.query('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  for (const code of codes) {
    await connection.query('INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)', [crypto.randomUUID(), userId, keyedHash(normalizeRecoveryCode(code))]);
  }
  return codes;
}

async function issueLoginChallenge(userId, challengeType, req) {
  await ensureSecuritySchema();
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('UPDATE mfa_login_challenges SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
  await pool.query(`INSERT INTO mfa_login_challenges
    (id, user_id, token_hash, challenge_type, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), ?, ?)`,
  [crypto.randomUUID(), userId, keyedHash(token), challengeType, req.ip || null, String(req.get('user-agent') || '').slice(0, 255)]);
  return token;
}

async function getChallenge(connection, token, expectedType) {
  if (!token || String(token).length > 200) return null;
  const [[challenge]] = await connection.query(`SELECT id, user_id, challenge_type, attempts
    FROM mfa_login_challenges WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1 FOR UPDATE`, [keyedHash(token)]);
  if (!challenge || challenge.attempts >= 5 || (expectedType && challenge.challenge_type !== expectedType)) return null;
  return challenge;
}

async function savePendingSecret(userId) {
  const secret = base32Encode(crypto.randomBytes(20));
  await pool.query(`INSERT INTO user_mfa_totp (user_id, pending_secret_ciphertext)
    VALUES (?, ?) ON DUPLICATE KEY UPDATE pending_secret_ciphertext = VALUES(pending_secret_ciphertext)`, [userId, encrypt(secret)]);
  return secret;
}

async function beginChallengeSetup(token) {
  await ensureSecuritySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const challenge = await getChallenge(connection, token, 'MFA_SETUP');
    if (!challenge) { await connection.rollback(); return null; }
    const secret = base32Encode(crypto.randomBytes(20));
    await connection.query(`INSERT INTO user_mfa_totp (user_id, pending_secret_ciphertext)
      VALUES (?, ?) ON DUPLICATE KEY UPDATE pending_secret_ciphertext = VALUES(pending_secret_ciphertext)`, [challenge.user_id, encrypt(secret)]);
    const [[user]] = await connection.query('SELECT email FROM users WHERE id = ? LIMIT 1', [challenge.user_id]);
    await connection.commit();
    return { secret, email: user?.email || 'user' };
  } finally { connection.release(); }
}

async function completeChallengeSetup(token, code) {
  await ensureSecuritySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const challenge = await getChallenge(connection, token, 'MFA_SETUP');
    if (!challenge) { await connection.rollback(); return null; }
    const [[record]] = await connection.query('SELECT pending_secret_ciphertext FROM user_mfa_totp WHERE user_id = ? FOR UPDATE', [challenge.user_id]);
    const valid = record?.pending_secret_ciphertext && verifyTotp(decrypt(record.pending_secret_ciphertext), code);
    if (!valid) {
      await connection.query('UPDATE mfa_login_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
      await connection.commit();
      return { invalid: true };
    }
    await connection.query(`UPDATE user_mfa_totp SET secret_ciphertext = pending_secret_ciphertext,
      pending_secret_ciphertext = NULL, verified_at = NOW() WHERE user_id = ?`, [challenge.user_id]);
    await connection.query("UPDATE users SET mfa_enabled = 1, last_mfa_update_at = NOW(), account_status = 'ACTIVE' WHERE id = ?", [challenge.user_id]);
    const recoveryCodes = await replaceRecoveryCodes(connection, challenge.user_id);
    await connection.query('UPDATE mfa_login_challenges SET used_at = NOW() WHERE id = ?', [challenge.id]);
    await connection.commit();
    return { userId: challenge.user_id, recoveryCodes };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

async function verifyLoginChallenge(token, code) {
  await ensureSecuritySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const challenge = await getChallenge(connection, token, 'MFA_VERIFY');
    if (!challenge) { await connection.rollback(); return null; }
    const [[record]] = await connection.query('SELECT secret_ciphertext, last_used_step FROM user_mfa_totp WHERE user_id = ? FOR UPDATE', [challenge.user_id]);
    const matchedStep = record?.secret_ciphertext ? matchingTotpStep(decrypt(record.secret_ciphertext), code) : null;
    let valid = matchedStep !== null && (record.last_used_step === null || matchedStep > Number(record.last_used_step));
    let recoveryId = null;
    if (!valid) {
      const recoveryHash = keyedHash(normalizeRecoveryCode(code));
      const [[recovery]] = await connection.query('SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1 FOR UPDATE', [challenge.user_id, recoveryHash]);
      if (recovery) { valid = true; recoveryId = recovery.id; }
    }
    if (!valid) {
      await connection.query('UPDATE mfa_login_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
      await connection.commit();
      return { invalid: true };
    }
    if (recoveryId) await connection.query('UPDATE mfa_recovery_codes SET used_at = NOW() WHERE id = ?', [recoveryId]);
    if (!recoveryId) await connection.query('UPDATE user_mfa_totp SET last_used_step = ? WHERE user_id = ?', [matchedStep, challenge.user_id]);
    await connection.query('UPDATE mfa_login_challenges SET used_at = NOW() WHERE id = ?', [challenge.id]);
    await connection.commit();
    return { userId: challenge.user_id, usedRecoveryCode: Boolean(recoveryId) };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

async function beginAuthenticatedSetup(userId) {
  await ensureSecuritySchema();
  return savePendingSecret(userId);
}

async function completeAuthenticatedSetup(userId, code) {
  await ensureSecuritySchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[record]] = await connection.query('SELECT pending_secret_ciphertext FROM user_mfa_totp WHERE user_id = ? FOR UPDATE', [userId]);
    if (!record?.pending_secret_ciphertext || !verifyTotp(decrypt(record.pending_secret_ciphertext), code)) { await connection.rollback(); return null; }
    await connection.query('UPDATE user_mfa_totp SET secret_ciphertext = pending_secret_ciphertext, pending_secret_ciphertext = NULL, verified_at = NOW() WHERE user_id = ?', [userId]);
    await connection.query("UPDATE users SET mfa_enabled = 1, last_mfa_update_at = NOW(), account_status = 'ACTIVE' WHERE id = ?", [userId]);
    const recoveryCodes = await replaceRecoveryCodes(connection, userId);
    await connection.commit();
    return recoveryCodes;
  } catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

async function getMfaSecret(userId) {
  const [[record]] = await pool.query('SELECT secret_ciphertext FROM user_mfa_totp WHERE user_id = ?', [userId]);
  return record?.secret_ciphertext ? decrypt(record.secret_ciphertext) : null;
}

async function regenerateRecoveryCodes(userId, code) {
  const secret = await getMfaSecret(userId);
  if (!secret || !verifyTotp(secret, code)) return null;
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const codes = await replaceRecoveryCodes(connection, userId); await connection.commit(); return codes; }
  catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

async function disableMfa(userId, code) {
  const secret = await getMfaSecret(userId);
  if (!secret || !verifyTotp(secret, code)) return false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM user_mfa_totp WHERE user_id = ?', [userId]);
    await connection.query('UPDATE users SET mfa_enabled = 0, last_mfa_update_at = NOW(), session_version = session_version + 1 WHERE id = ?', [userId]);
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback().catch(() => {}); throw error; } finally { connection.release(); }
}

module.exports = {
  beginAuthenticatedSetup, beginChallengeSetup, completeAuthenticatedSetup, completeChallengeSetup,
  disableMfa, issueLoginChallenge, regenerateRecoveryCodes, requiresMfa, verifyLoginChallenge, verifyTotp, getMfaSecret,
  _test: { base32Decode, totp }
};
