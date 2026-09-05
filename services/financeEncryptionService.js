const crypto = require('crypto');

const KEY_VERSION = 'v1';

function encryptionKey() {
  const value = String(process.env.FINANCE_ENCRYPTION_KEY || '').trim();
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try { key = Buffer.from(value, 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) {
    const error = new Error('FINANCE_ENCRYPTION_KEY must be a 32-byte hex or base64 secret.');
    error.code = 'FINANCE_ENCRYPTION_KEY_INVALID';
    throw error;
  }
  return key;
}

function encryptSensitive(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSensitive(payload) {
  const [version, ivText, tagText, encryptedText] = String(payload || '').split('.');
  if (version !== KEY_VERSION || !ivText || !tagText || !encryptedText) throw new Error('Sensitive value has an invalid encrypted format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

function maskAccount(lastFour) {
  const suffix = String(lastFour || '').replace(/\D/g, '').slice(-4);
  return suffix ? `••••${suffix}` : '••••';
}

module.exports = { KEY_VERSION, decryptSensitive, encryptSensitive, encryptionKey, maskAccount };
