'use strict';
const PACKAGE_ID = 'com.voxelveda.app';
function association() {
  const values = String(process.env.ANDROID_APP_SIGNING_SHA256 || '').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
  if (!values.length || values.length > 10 || values.some(v => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v))) return null;
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE_ID, sha256_cert_fingerprints: [...new Set(values)] } }];
}
function serveAssociation(req, res) {
  const value = association();
  return res.status(value ? 200 : 503).set('Cache-Control', value ? 'public, max-age=3600' : 'no-store').json(value || []);
}
module.exports = { association, serveAssociation, PACKAGE_ID };
