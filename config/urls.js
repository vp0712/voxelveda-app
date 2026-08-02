const DEFAULT_WEBSITE_URL = 'https://voxelveda.com';
const DEFAULT_APP_URL = 'https://app.voxelveda.com';

function normalizeOrigin(value, fallback) {
  const candidate = String(value || fallback || '').trim().replace(/\/$/, '');
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

const website = normalizeOrigin(process.env.PUBLIC_WEBSITE_URL, DEFAULT_WEBSITE_URL);
const app = normalizeOrigin(process.env.PUBLIC_APP_URL || process.env.APP_URL, DEFAULT_APP_URL);

function absolute(pathname = '/', origin = app) {
  const safePath = String(pathname || '/').startsWith('/') ? pathname : `/${pathname}`;
  return new URL(safePath, `${origin}/`).toString();
}

module.exports = {
  website,
  app,
  api: `${app}/api`,
  login: '/login',
  dashboard: '/dashboard',
  admin: '/admin',
  support: '/support',
  privacy: '/privacy',
  terms: '/terms',
  absolute
};
