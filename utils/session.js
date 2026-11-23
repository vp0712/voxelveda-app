const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const SESSION_COOKIE = 'vv_session';
const RESUME_COOKIE = 'vv_resume';
const HOST_RESUME_COOKIE = '__Host-vv_resume';
const ACCESS_TYPE = 'vv_access';
const RESUME_TYPE = 'vv_resume';
const ORDINARY_SESSION_SECONDS = 96 * 60 * 60;
const PRIVILEGED_SESSION_SECONDS = 2 * 60 * 60;
const ACCESS_SECONDS = 15 * 60;
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin', 'finance_admin', 'accountant', 'hr']);
const SESSION_COOKIES = new Set([SESSION_COOKIE, RESUME_COOKIE, HOST_RESUME_COOKIE]);

function sessionWindowSeconds(role) {
  if (!PRIVILEGED_ROLES.has(String(role || '').trim().toLowerCase())) return ORDINARY_SESSION_SECONDS;
  const match = String(process.env.PRIVILEGED_SESSION_EXPIRES_IN || '').trim().match(/^(\d+)([smhd])$/i);
  if (!match) return PRIVILEGED_SESSION_SECONDS;
  const units = { s: 1, m: 60, h: 3600, d: 86400 };
  const requested = Number(match[1]) * units[match[2].toLowerCase()];
  return requested > 0 ? Math.min(requested, PRIVILEGED_SESSION_SECONDS) : PRIVILEGED_SESSION_SECONDS;
}

function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const item of String(header).split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    if (!SESSION_COOKIES.has(name)) continue;
    try { cookies[name] ??= decodeURIComponent(item.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return cookies;
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return '';
  const token = authorization.slice(7).trim();
  return token === 'null' || token === 'undefined' ? '' : token;
}

function hasSessionCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(cookies[SESSION_COOKIE] || cookies[resumeCookieName(req)]);
}

function getRequestToken(req) {
  const bearer = bearerToken(req);
  if (bearer) return bearer;
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  if (!cookies[resumeCookieName(req)] && process.env.NODE_ENV !== 'production' && process.env.ALLOW_LEGACY_QUERY_TOKENS === 'true') {
    return String(req.query?.token || '').trim();
  }
  return '';
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function sessionCredentialHash(token, decoded) {
  if (decoded.session_type === ACCESS_TYPE) {
    return /^[a-f0-9]{64}$/.test(decoded.session_hash) ? decoded.session_hash : null;
  }
  return tokenHash(token);
}

function verifyCredential(token, expected, secret, options) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], ...options });
    if (!decoded?.id || !Number.isInteger(decoded.exp)) return null;
    if (expected === RESUME_TYPE && decoded.session_type !== RESUME_TYPE) return null;
    if (expected === ACCESS_TYPE && decoded.session_type && decoded.session_type !== ACCESS_TYPE) return null;
    if (decoded.session_type && !decoded.jti) return null;
    return { token, decoded, type: decoded.session_type || 'legacy' };
  } catch (error) {
    if (['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'].includes(error?.name)) return null;
    throw error;
  }
}

function getSessionCredential(req, secret, options = {}) {
  const bearer = bearerToken(req);
  if (bearer) return verifyCredential(bearer, ACCESS_TYPE, secret, options);
  const cookies = parseCookies(req.headers.cookie);
  // The durable resume cookie may only be used from the secure cookie jar.
  // If both cookies are present, reject stale access from a different binding.
  const access = verifyCredential(cookies[SESSION_COOKIE], ACCESS_TYPE, secret, options);
  const resumeToken = cookies[resumeCookieName(req)];
  if (resumeToken && access?.type === ACCESS_TYPE &&
      sessionCredentialHash(access.token, access.decoded) === tokenHash(resumeToken)) return access;
  const resume = verifyCredential(resumeToken, RESUME_TYPE, secret, options);
  if (resume) {
    // A valid resume cookie is authoritative if an in-flight response from an
    // earlier account has left a mismatched access cookie in the same browser.
    return resume;
  }
  if (access || resumeToken) return access;
  return verifyCredential(getRequestToken(req), ACCESS_TYPE, secret, options);
}

function secureRequest(req) {
  return process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function resumeCookieName(req) {
  return secureRequest(req) ? HOST_RESUME_COOKIE : RESUME_COOKIE;
}

function cookieOptions(req, hostOnly = false) {
  const configuredDomain = String(process.env.COOKIE_DOMAIN || '').trim();
  const hostname = String(req.hostname || '').toLowerCase();
  const domainHost = configuredDomain.replace(/^\./, '').toLowerCase();
  const options = {
    httpOnly: true,
    secure: secureRequest(req),
    sameSite: 'strict',
    path: '/'
  };
  // Keep cookies host-only when the configured domain cannot include this host.
  if (!hostOnly && domainHost && (hostname === domainHost || hostname.endsWith(`.${domainHost}`))) options.domain = configuredDomain;
  return options;
}

function setResumeCookie(req, res, token, expiresAt) {
  res.cookie(resumeCookieName(req), token, { ...cookieOptions(req, true), expires: expiresAt });
}

function setAccessCookie(req, res, resume, secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const expiry = Math.min(resume.decoded.exp, iat + ACCESS_SECONDS);
  if (expiry <= iat) return;
  const token = jwt.sign({
    id: resume.decoded.id,
    session_type: ACCESS_TYPE,
    session_hash: tokenHash(resume.token),
    iat,
    exp: expiry
  }, secret, { algorithm: 'HS256', jwtid: resume.decoded.jti });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), expires: new Date(expiry * 1000) });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.clearCookie(resumeCookieName(req), cookieOptions(req, true));
}

function safeReturnTo(value, fallback = '/') {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, 'https://app.voxelveda.com');
    if (url.origin !== 'https://app.voxelveda.com') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

const SIGN_IN_ROUTES = new Set([
  '/dashboard', '/security', '/profile', '/admin', '/client', '/account', '/quality', '/shop-floor',
  '/attendance-terminal', '/a', '/attendance/scan', '/invoice/view', '/document/view', '/employee-id',
  '/careers-admin', '/rfqs', '/quotations', '/invoices', '/customers', '/suppliers', '/procurement',
  '/stock', '/inventory', '/raw-material', '/packaging', '/expenses', '/workforce', '/timesheets',
  '/roster', '/staff', '/compliance', '/forms', '/settings', '/meetings', '/tasks', '/trash', '/approvals'
]);

function signInReturnTo(value) {
  const safe = safeReturnTo(value, '/dashboard');
  const pathname = safe.split(/[?#]/, 1)[0];
  return SIGN_IN_ROUTES.has(pathname) || /^\/portal\/(staff|manager|supervisor|hr|production|sales)$/.test(pathname) ? safe : '/dashboard';
}

module.exports = {
  RESUME_TYPE, getRequestToken, getSessionCredential, hasSessionCookie, sessionWindowSeconds,
  tokenHash, sessionCredentialHash, setResumeCookie, setAccessCookie, clearSessionCookie,
  safeReturnTo, signInReturnTo
};
