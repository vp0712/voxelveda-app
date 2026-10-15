'use strict';
const CANONICAL_ORIGIN = 'https://app.voxelveda.com';
const LEGACY_HOST = 'voxelveda-app-production.up.railway.app';

function canonicalApplication(req, res, next) {
  if (['/api/health', '/api/ready'].includes(req.path)) return next();
  const configured = String(process.env.RAILWAY_FALLBACK_HOST || LEGACY_HOST).toLowerCase();
  const host = String(req.hostname || '').toLowerCase();
  if (host !== LEGACY_HOST && !(configured.endsWith('.up.railway.app') && host === configured)) return next();
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(409).json({ code: 'CANONICAL_ORIGIN_REQUIRED', message: 'Open Voxel Veda at https://app.voxelveda.com and check the record before submitting again.', app_url: CANONICAL_ORIGIN });
  }
  const path = String(req.originalUrl || '/');
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n\x00-\x1f]/.test(path)) return res.status(400).send('Invalid application path.');
  return res.redirect(308, CANONICAL_ORIGIN + path);
}
module.exports = { canonicalApplication, CANONICAL_ORIGIN, LEGACY_HOST };
