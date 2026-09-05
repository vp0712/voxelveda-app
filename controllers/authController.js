const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { effectivePermissions } = require('../services/authorizationService');
const { getRequestToken, setSessionCookie, clearSessionCookie } = require('../utils/session');
const { ensureUserLifecycleSchema } = require('../services/userLifecycleService');
const { ensureSecuritySchema } = require('../services/securitySchema');
const { revokeSession, logSecurityEvent } = require('../services/sessionService');
const { validatePassword } = require('../services/passwordPolicy');
const { createAuthenticatedSession } = require('../services/authSessionService');
const { issueLoginChallenge, requiresMfa } = require('../services/mfaService');

function normalizeRole(role) {
  return String(role || 'staff').trim().toLowerCase();
}

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function publicUsernameFromEmail(email) {
  const base = String(email || '')
    .split('@')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .slice(0, 42) || 'customer';
  return `${base}_${String(Date.now()).slice(-5)}`;
}

exports.login = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, username, email, password, role, permissions, active,
              account_status, failed_login_count, locked_until, session_version, password_reset_required, mfa_enabled
       FROM users
       WHERE (LOWER(email) = ? OR LOWER(username) = ?)
         AND deleted_at IS NULL
       LIMIT 1`,
      [email, email]
    );

    if (!rows.length) {
      await logSecurityEvent({ eventType: 'LOGIN_FAILURE', result: 'DENIED', req, metadata: { reason: 'INVALID_CREDENTIALS' } });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = rows[0];

    const blockedStates = ['INVITED', 'PASSWORD_RESET_REQUIRED', 'LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'];
    if (Number(user.active) === 0 || blockedStates.includes(String(user.account_status || '').toUpperCase()) || (user.locked_until && new Date(user.locked_until) > new Date())) {
      await logSecurityEvent({ targetUserId: user.id, eventType: 'LOGIN_FAILURE', result: 'DENIED', req, metadata: { reason: 'ACCOUNT_UNAVAILABLE' } });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      const attempts = Number(user.failed_login_count || 0) + 1;
      const lockMinutes = attempts >= 10 ? Math.min(60, Math.pow(2, Math.floor((attempts - 10) / 2))) : 0;
      await pool.query(
        'UPDATE users SET failed_login_count = ?, locked_until = IF(? > 0, DATE_ADD(NOW(), INTERVAL ? MINUTE), locked_until) WHERE id = ?',
        [attempts, lockMinutes, lockMinutes, user.id]
      );
      await logSecurityEvent({ targetUserId: user.id, eventType: 'LOGIN_FAILURE', result: 'DENIED', req, metadata: { reason: 'INVALID_CREDENTIALS', temporary_lock: lockMinutes > 0 } });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const sessionUser = {
      id: user.id,
      name: user.name || 'User',
      username: user.username || user.email,
      email: user.email,
      role: normalizeRole(user.role),
      permissions: parsePermissions(user.permissions),
      session_version: Number(user.session_version || 1)
    };

    if (Number(user.mfa_enabled) === 1 || requiresMfa(user.role)) {
      clearSessionCookie(req, res);
      const setupRequired = Number(user.mfa_enabled) !== 1;
      if (setupRequired) await pool.query("UPDATE users SET account_status = 'MFA_SETUP_REQUIRED' WHERE id = ?", [user.id]);
      const challengeToken = await issueLoginChallenge(user.id, setupRequired ? 'MFA_SETUP' : 'MFA_VERIFY', req);
      await logSecurityEvent({ actorId: user.id, targetUserId: user.id, eventType: setupRequired ? 'MFA_SETUP_REQUIRED' : 'MFA_CHALLENGE_ISSUED', req });
      return res.status(202).json({
        message: setupRequired ? 'Multi-factor authentication setup is required.' : 'Multi-factor authentication is required.',
        mfa_required: true,
        mfa_setup_required: setupRequired,
        challenge_token: challengeToken,
        expires_in: 300
      });
    }

    const session = await createAuthenticatedSession({ user: sessionUser, req, res, assuranceLevel: 1 });
    await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
    await logSecurityEvent({ actorId: user.id, targetUserId: user.id, sessionId: session.sessionId, eventType: 'LOGIN_SUCCESS', req });

    res.json({
      message: 'Login successful',
      user: session.user,
      requires_password_change: Number(user.password_reset_required) === 1
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({
      message: 'Login failed'
    });
  }
};

exports.register = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    await ensureSecuritySchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role || 'staff');
    const username = String(req.body.username || email.split('@')[0] || '').trim().toLowerCase();
    const permissions = parsePermissions(req.body.permissions);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    const passwordCheck = validatePassword(password, { email, username, name });
    if (!passwordCheck.valid) return res.status(400).json({ message: passwordCheck.errors[0] });

    const allowedRoles = ['admin', 'staff', 'sales', 'production', 'viewer'];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (name, username, email, password, role, permissions, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name, username, email, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({
      message: 'Registration failed'
    });
  }
};

exports.me = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const [rows] = await pool.query(
      'SELECT id, name, username, email, role, permissions, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];
    const permissions = parsePermissions(user.permissions);

    res.json({
      user: {
        id: user.id,
        name: user.name || 'User',
        username: user.username || user.email,
        email: user.email,
        role: normalizeRole(user.role),
        permissions,
        effective_permissions: [...effectivePermissions({ role: user.role, permissions })],
        active: Number(user.active) !== 0
      }
    });
  } catch (err) {
    console.error('ME ERROR:', err);
    res.status(500).json({
      message: 'Failed to load user'
    });
  }
};

exports.customerRegister = async (req, res) => {
  try {
    await ensureUserLifecycleSchema();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirmPrivacy = Boolean(req.body.confirm_privacy);

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Valid email address is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    if (!confirmPrivacy) {
      return res.status(400).json({ message: 'Please accept the privacy policy before creating an account' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({ message: 'An account already exists for this email. Please login or contact admin.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const username = publicUsernameFromEmail(email);
    const role = 'viewer';
    const permissions = [];

    await pool.query(
      `INSERT INTO users (name, username, email, password, role, permissions, active, password_reset_required)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
      [name, username, email, hashedPassword, role, JSON.stringify(permissions)]
    );

    res.json({
      message: 'Customer account created successfully. You can login now. Admin can add extra access if needed.'
    });
  } catch (err) {
    console.error('CUSTOMER REGISTER ERROR:', err);
    res.status(500).json({
      message: 'Customer account registration failed'
    });
  }
};

exports.logout = async (req, res) => {
  const token = getRequestToken(req);
  if (token) await revokeSession(token, 'LOGOUT').catch(() => {});
  clearSessionCookie(req, res);
  return res.json({ message: 'Logout successful' });
};

exports.refreshSessionCookie = async (req, res) => {
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ message: 'Authorization token missing' });
  setSessionCookie(req, res, token);
  return res.json({ message: 'Session refreshed' });
};
