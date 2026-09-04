const crypto = require('crypto');
const path = require('path');

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const GENERAL_LIMIT = Number(process.env.RATE_LIMIT_MAX || 900);
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_MAX || 25);
const buckets = new Map();

function clientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function rateLimit({ windowMs = WINDOW_MS, max = GENERAL_LIMIT, keyPrefix = 'global' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${clientIp(req)}`;
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    buckets.set(key, entry);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      if (!req.path.startsWith('/api/') && req.accepts('html')) {
        return res.status(429).sendFile(path.join(__dirname, '..', 'public', '429.html'));
      }
      return res.status(429).json({ message: 'Too many requests. Please wait and try again.' });
    }

    next();
  };
}

function securityHeaders(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = String(requestId).slice(0, 80);
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://app.voxelveda.com https://voxelveda.com https://cdn.jsdelivr.net",
      "frame-src 'self' blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:"
    ].join('; ')
  );

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  next();
}

function csrfProtection(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const hasSessionCookie = String(req.headers.cookie || '').includes('vv_session=');
  const hasBearer = String(req.headers.authorization || '').startsWith('Bearer ');
  if (!hasSessionCookie || hasBearer) return next();
  const origin = String(req.headers.origin || '');
  if (origin && allowedOrigins().includes(origin)) return next();
  return res.status(403).json({ message: 'Request origin could not be verified' });
}

function allowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || process.env.APP_ORIGIN;
  const productionDefaults = [
    'https://app.voxelveda.com',
    'https://voxelveda.com',
    'https://voxelveda-app-production.up.railway.app'
  ];
  const developmentDefaults = [
    'http://localhost:3000',
    'http://localhost:5001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5001'
  ];
  const source = configured || (process.env.NODE_ENV === 'production' ? productionDefaults.join(',') : developmentDefaults.join(','));

  return String(source)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsOptions() {
  const allowList = allowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
  };
}

function safeErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || (err.message === 'CORS origin not allowed' ? 403 : 500);
  const requestId = res.getHeader('X-Request-Id');
  console.error('Request error:', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    message: err.message
  });
  if (!req.path.startsWith('/api/') && req.accepts('html')) {
    const filename = [401, 403, 404, 429].includes(status) ? `${status}.html` : '500.html';
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.status(status).sendFile(path.join(__dirname, '..', 'public', filename));
  }
  return res.status(status).json({
    message: status >= 500 ? 'Server error. Please contact admin if this continues.' : err.message,
    requestId
  });
}

function authRateLimit() {
  return rateLimit({ windowMs: 15 * 60 * 1000, max: AUTH_LIMIT, keyPrefix: 'auth' });
}

module.exports = {
  authRateLimit,
  corsOptions,
  csrfProtection,
  rateLimit,
  securityHeaders,
  safeErrorHandler
};
