const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const revoked = new Map();

function tokenKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function prune() {
  const now = Date.now();
  for (const [key, expiresAt] of revoked.entries()) {
    if (expiresAt <= now) revoked.delete(key);
  }
}

function revoke(token) {
  if (!token) return;
  const decoded = jwt.decode(token) || {};
  const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000;
  revoked.set(tokenKey(token), expiresAt);
  prune();
}

function isRevoked(token) {
  prune();
  return revoked.has(tokenKey(token));
}

module.exports = { revoke, isRevoked };
