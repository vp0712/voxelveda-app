const SESSION_COOKIE = 'vv_session';

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separator = item.indexOf('=');
      if (separator < 1) return cookies;
      const key = decodeURIComponent(item.slice(0, separator).trim());
      const value = decodeURIComponent(item.slice(separator + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function getRequestToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer && bearer !== 'null' && bearer !== 'undefined') return bearer;
  }
  const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_LEGACY_QUERY_TOKENS === 'true') {
    return String(req.query?.token || '').trim();
  }
  return '';
}

function expiresInMs(value = process.env.JWT_EXPIRES_IN || '8h') {
  const match = String(value).trim().match(/^(\d+)([smhd])$/i);
  if (!match) return 8 * 60 * 60 * 1000;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * units[match[2].toLowerCase()];
}

function cookieOptions(req) {
  const configuredDomain = String(process.env.COOKIE_DOMAIN || '').trim();
  const hostname = String(req.hostname || '').toLowerCase();
  const domainHost = configuredDomain.replace(/^\./, '').toLowerCase();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInMs()
  };

  // A .voxelveda.com cookie is invalid on the Railway fallback host, so keep it host-only there.
  if (domainHost && (hostname === domainHost || hostname.endsWith(`.${domainHost}`))) {
    options.domain = configuredDomain;
  }
  return options;
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(req));
}

function clearSessionCookie(req, res) {
  const options = cookieOptions(req);
  delete options.maxAge;
  res.clearCookie(SESSION_COOKIE, options);
}

function safeReturnTo(value, fallback = '/') {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback;
  try {
    const url = new URL(candidate, 'https://app.voxelveda.com');
    if (url.origin !== 'https://app.voxelveda.com') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

module.exports = {
  SESSION_COOKIE,
  getRequestToken,
  setSessionCookie,
  clearSessionCookie,
  safeReturnTo
};
