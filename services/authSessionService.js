const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createSession } = require('./sessionService');
const { RESUME_TYPE, sessionWindowSeconds, setResumeCookie, setAccessCookie } = require('../utils/session');
const { activePermissionProjection } = require('./authorizationService');
const deviceNotices = require('./deviceNoticeService');

function normalizeRole(value) { return String(value || 'staff').trim().toLowerCase(); }

async function createAuthenticatedSession({ user, req, res, assuranceLevel = 1 }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is missing');
  const sessionId = crypto.randomUUID();
  const publicUser = {
    id: user.id,
    name: user.name || 'User',
    username: user.username || user.email,
    email: user.email,
    role: normalizeRole(user.role),
    permissions: activePermissionProjection(user.permissions)
  };
  const signedInAt = Math.floor(Date.now() / 1000);
  const expiry = signedInAt + sessionWindowSeconds(publicUser.role);
  const decoded = { id: user.id, session_type: RESUME_TYPE, iat: signedInAt, exp: expiry, jti: sessionId };
  const token = jwt.sign(decoded, secret, { algorithm: 'HS256' });
  const expiresAt = new Date(expiry * 1000);
  await createSession({
    id: sessionId, token, userId: user.id, sessionVersion: Number(user.session_version || 1),
    assuranceLevel, expiresAt, req
  });
  try {
    await deviceNotices.onSignIn(req, user.id);
  } catch (error) {
    console.error('DEVICE NOTICE SIGN-IN SYNC:', error?.code || error?.name || 'UNKNOWN');
  }
  setResumeCookie(req, res, token, expiresAt);
  setAccessCookie(req, res, { token, decoded }, secret);
  return { user: publicUser, sessionId };
}

module.exports = { createAuthenticatedSession, normalizeRole };
