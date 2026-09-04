const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { createSession } = require('./sessionService');
const { setSessionCookie } = require('../utils/session');

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function normalizeRole(value) { return String(value || 'staff').trim().toLowerCase(); }

function sessionDuration(role) {
  return ['super_admin', 'admin', 'finance_admin', 'accountant', 'hr'].includes(normalizeRole(role))
    ? (process.env.PRIVILEGED_SESSION_EXPIRES_IN || '2h')
    : (process.env.JWT_EXPIRES_IN || '8h');
}

async function createAuthenticatedSession({ user, req, res, assuranceLevel = 1 }) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is missing');
  const sessionId = crypto.randomUUID();
  const publicUser = {
    id: user.id,
    name: user.name || 'User',
    username: user.username || user.email,
    email: user.email,
    role: normalizeRole(user.role),
    permissions: parsePermissions(user.permissions)
  };
  const token = jwt.sign({
    id: user.id,
    email: publicUser.email,
    username: publicUser.username,
    role: publicUser.role,
    permissions: publicUser.permissions,
    session_version: Number(user.session_version || 1),
    assurance_level: assuranceLevel
  }, process.env.JWT_SECRET, { expiresIn: sessionDuration(user.role), jwtid: sessionId });
  const decoded = jwt.decode(token);
  await createSession({ id: sessionId, token, userId: user.id, sessionVersion: Number(user.session_version || 1), assuranceLevel, expiresAt: new Date(Number(decoded.exp) * 1000), req });
  setSessionCookie(req, res, token);
  return { user: publicUser, sessionId };
}

module.exports = { createAuthenticatedSession, normalizeRole, parsePermissions };
