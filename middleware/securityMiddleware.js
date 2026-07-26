const crypto = require('crypto');

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
      return res.status(429).json({ message: 'Too many requests. Please wait and try again.' });
    }

    next();
  };
}

function securityHeaders(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
}

function allowedOrigins() {
  return String(process.env.CORS_ORIGINS || process.env.APP_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsOptions() {
  const allowList = allowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!allowList.length) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
  rateLimit,
  securityHeaders,
  safeErrorHandler
};
