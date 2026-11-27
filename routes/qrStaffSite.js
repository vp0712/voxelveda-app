'use strict';

const express = require('express');
const path = require('node:path');
const urls = require('../config/urls');
const { isQrStaffHost, qrStaffOrigin } = require('../config/qrStaffOrigin');
const auth = require('../middleware/auth');
const pageAuth = require('../middleware/pageAuth');
const { rateLimit } = require('../middleware/securityMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const phone = require('../services/qrPhoneService');
const actions = require('../services/attendanceActionService');
const daily = require('../services/attendanceDailyService');
const qr = require('../services/attendanceQrService');
const { renderAttendanceQr } = require('../services/attendanceQrRenderer');
const policy = require('../services/attendanceMobilePolicy');

const DEVICE = '__Host-vv_qr_staff';
const VERIFIER = '__Host-vv_qr_link';
const jar = { httpOnly: true, sameSite: 'lax', secure: true, path: '/' };
const viewsDir = path.join(__dirname, '..', 'views', 'qr-staff');
const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
const emptyBody = bodyContract([], { allowEmpty: true });
const qrRoutes = express.Router();
const portal = express.Router();
const DISPLAY_WINDOW_MS = 30_000;
const displayImages = new Map();

const deviceLimit = rateLimit({
  keyPrefix: 'qrstaff:user', max: 60, windowMs: 60000,
  keyGenerator: req => String(req.qrIdentity.user.id)
});
const enrolLimit = rateLimit({ keyPrefix: 'qrstaff:link', max: 30, windowMs: 60000 });
const publicLimit = rateLimit({ keyPrefix: 'qrstaff:public', max: 600, windowMs: 60000 });

function reject(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function cookie(req, name) {
  const prefix = name + '=';
  const values = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(prefix));
  if (values.length !== 1) return '';
  const value = values[0].slice(prefix.length);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function privatePage(_req, res, next) {
  res.set({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  res.removeHeader('Content-Security-Policy-Report-Only');
  next();
}
function ownJson(origin) {
  return (req, res, next) => {
    if (req.get('Origin') !== origin() || req.get('Sec-Fetch-Site') === 'cross-site') {
      return res.status(403).json({ code: 'QR_ORIGIN_REJECTED', message: 'Open the attendance page directly and try again.' });
    }
    if (!req.is('application/json')) return res.status(415).json({ message: 'Send a JSON request.' });
    next();
  };
}
function sendFile(absolutePath) {
  return (_req, res) => res.sendFile(absolutePath, { cacheControl: false, lastModified: false });
}
function failure(err, _req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err.statusCode || err.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const code = typeof err.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(err.code) ? err.code : 'QR_REQUEST_INVALID';
    const message = err.type === 'entity.parse.failed' ? 'Invalid JSON.' : err.message;
    return res.status(status).json({ code, message });
  }
  res.status(503).json({ code: 'QR_TEMPORARILY_UNAVAILABLE', message: 'Attendance is temporarily unavailable. Try again shortly.' });
}
function requireEnabled(_req, res, next) {
  if (!qrStaffOrigin()) return res.status(503).json({ code: 'QR_DISABLED', message: 'Staff QR is awaiting activation.' });
  next();
}
async function identify(req, res, optional) {
  const credential = cookie(req, DEVICE);
  if (credential) {
    try {
      const identity = await phone.verify(credential);
      policy.actor(identity.user);
      return identity;
    } catch (error) {
      if (error.statusCode !== 401) throw error;
      res.clearCookie(DEVICE, jar);
    }
  }
  if (optional) return null;
  throw reject('Link this phone to your staff account.', 'QR_PHONE_UNLINKED', 401);
}
const linked = asyncRoute(async (req, res, next) => {
  req.qrIdentity = await identify(req, res, false);
  next();
});
async function viewState(user) {
  const state = await daily.readToday({ user });
  const action = state.allowed_actions.find(v => v === 'CHECK_IN' || v === 'CHECK_OUT') || null;
  return {
    linked: true,
    staff_id: Number(user.id),
    staff_name: state.profile?.name || user.name || user.username || 'Staff',
    site_name: String(process.env.SHIFT_QR_SITE_LABEL || '').trim().slice(0, 120) || 'Workplace',
    status: state.status, action,
    attendance_id: action === 'CHECK_OUT' ? state.active_attendance?.id ?? null : null,
    timezone: state.company_timezone
  };
}
function publicReceipt(receipt, timezone) {
  if (!receipt || !['CHECK_IN','CHECK_OUT'].includes(receipt.action)) return null;
  const stamp = receipt.action === 'CHECK_IN' ? receipt.attendance?.clock_in : receipt.attendance?.clock_out;
  return { action: receipt.action, attendance_id: receipt.attendance_id, request_id: receipt.request_id, saved_at: stamp || null, timezone };
}

qrRoutes.use(privatePage, requireEnabled);
qrRoutes.get('/', sendFile(path.join(viewsDir, 'display.html')));
qrRoutes.get(['/a', '/setup', '/remote'], sendFile(path.join(viewsDir, 'index.html')));
qrRoutes.get('/qr-staff/display.js', sendFile(path.join(viewsDir, 'display.js')));
qrRoutes.get('/qr-staff/staff.js', sendFile(path.join(viewsDir, 'staff.js')));
qrRoutes.get('/qr-staff/site.css', sendFile(path.join(viewsDir, 'site.css')));
qrRoutes.get('/qr-staff/current', publicLimit, (_req, res) => {
  const now = Date.now();
  const slot = Math.floor(now / DISPLAY_WINDOW_MS);
  res.json({
    image_url: '/qr-staff/attendance.png?v=' + slot,
    expires_at: new Date((slot + 1) * DISPLAY_WINDOW_MS).toISOString(),
    server_time: new Date(now).toISOString()
  });
});
qrRoutes.get('/qr-staff/attendance.png', publicLimit, asyncRoute(async (req, res) => {
  const current = Math.floor(Date.now() / DISPLAY_WINDOW_MS);
  const version = req.query.v;
  if (version !== undefined && version !== String(current) && version !== String(current - 1)) return res.sendStatus(404);
  const slot = version === undefined ? current : Number(version);
  for (const key of displayImages.keys()) {
    if (key !== current && key !== current - 1) displayImages.delete(key);
  }
  if (!displayImages.has(slot)) {
    const target = new URL('/remote', qrStaffOrigin());
    target.searchParams.set('v', String(slot));
    const image = renderAttendanceQr(target.href, 16).catch(error => {
      if (displayImages.get(slot) === image) displayImages.delete(slot);
      throw error;
    });
    displayImages.set(slot, image);
  }
  const { buffer } = await displayImages.get(slot);
  res.type('png').send(buffer);
}));
qrRoutes.get('/logo.png', sendFile(logoPath));
qrRoutes.use('/qr-api', publicLimit);
qrRoutes.post('/qr-api/*', ownJson(qrStaffOrigin), express.json({ limit: '8kb', strict: true }));

qrRoutes.get('/qr-api/session', asyncRoute(async (req, res) => {
  const identity = await identify(req, res, true);
  res.json(identity ? await viewState(identity.user) : { linked: false });
}));
qrRoutes.post('/qr-api/link/start', enrolLimit, emptyBody, asyncRoute(async (req, res) => {
  if (await identify(req, res, true)) throw reject('Unlink the current account first.', 'QR_ALREADY_LINKED', 409);
  const { verifier, challenge } = await phone.begin();
  res.cookie(VERIFIER, verifier, { ...jar, maxAge: phone.LINK_SECONDS * 1000 });
  const appLink = new URL('/attendance/link-phone', urls.app);
  appLink.searchParams.set('challenge', challenge);
  res.json({ url: appLink.href });
}));
qrRoutes.post('/qr-api/link/finish', enrolLimit, bodyContract(['code'], { required: ['code'] }), asyncRoute(async (req, res) => {
  if (await identify(req, res, true)) throw reject('Unlink the current account first.', 'QR_ALREADY_LINKED', 409);
  const { credential } = await phone.redeem({ code: req.body.code, verifier: cookie(req, VERIFIER) });
  res.clearCookie(VERIFIER, jar);
  res.cookie(DEVICE, credential, { ...jar, maxAge: phone.DEVICE_SECONDS * 1000 });
  res.json({ linked: true });
}));
qrRoutes.post('/qr-api/unlink', emptyBody, asyncRoute(async (req, res) => {
  const credential = cookie(req, DEVICE);
  if (credential) await phone.revoke(credential);
  res.clearCookie(DEVICE, jar);
  res.clearCookie(VERIFIER, jar);
  res.json({ linked: false });
}));
const scanAction = remoteQr => asyncRoute(async (req, res) => {
  const user = req.qrIdentity.user;
  const site = remoteQr ? null : qr.validateSiteToken(req.body.token);
  const snapshot = await viewState(user);
  if (!snapshot.action) throw reject('Your attendance requires review. Contact your supervisor.', 'ATTENDANCE_REVIEW_REQUIRED', 409);
  const result = await actions.resolveQr({ user, input: { action: snapshot.action, attendance_id: snapshot.attendance_id, token: req.body.token }, remoteDeviceId: remoteQr ? req.qrIdentity.deviceId : null });
  const expiry = Math.min(site ? site.exp * 1000 : Infinity, Date.parse(result.expires_at));
  res.json({ ...snapshot, qr_proof: result.qr_proof, expires_at: new Date(expiry).toISOString() });
});
qrRoutes.post('/qr-api/scan', linked, deviceLimit, bodyContract(['token'], { required: ['token'] }), scanAction(false));
qrRoutes.post('/qr-api/remote/scan', linked, deviceLimit, emptyBody, scanAction(true));
const confirmFields = ['action', 'attendance_id', 'qr_proof', 'request_id'];
const requiredConfirmFields = ['action', 'qr_proof', 'request_id'];
const confirmAction = remoteQr => asyncRoute(async (req, res) => {
  const { token, action, attendance_id, qr_proof, request_id } = req.body;
  if (!['CHECK_IN','CHECK_OUT'].includes(action)) throw reject('Choose check in or check out.', 'ATTENDANCE_ACTION_INVALID', 422);
  const result = await actions.performAction({
    user: req.qrIdentity.user, req, requireSiteScan: !remoteQr, remoteQr, phoneDeviceId: req.qrIdentity.deviceId,
    input: { site_token: token, action, attendance_id, qr_proof, request_id }
  });
  res.json({ receipt: publicReceipt(result, result.state.company_timezone) });
});
qrRoutes.post('/qr-api/confirm', linked, deviceLimit, bodyContract(['token', ...confirmFields], { required: ['token', ...requiredConfirmFields] }), confirmAction(false));
qrRoutes.post('/qr-api/remote/confirm', linked, deviceLimit, bodyContract(confirmFields, { required: requiredConfirmFields }), confirmAction(true));
qrRoutes.post('/qr-api/reconcile', linked, deviceLimit, bodyContract(['request_id'], { required: ['request_id'] }), asyncRoute(async (req, res) => {
  const requestId = policy.requestId(req.body.request_id);
  const result = await actions.reconcileAction({ user: req.qrIdentity.user, requestId });
  const receipt = publicReceipt(result.receipt, result.state.company_timezone);
  res.json({ found: Boolean(receipt), receipt });
}));
qrRoutes.use((_req, res) => res.status(404).json({ message: 'Page unavailable on the staff QR site.' }));
qrRoutes.use(failure);
function host(req, res, next) {
  if (isQrStaffHost(req)) return qrRoutes(req, res, next);
  next();
}

const appPost = ownJson(() => urls.app);
function portalOnly(req, res, next) {
  if (String(req.get('Host') || '').toLowerCase() !== new URL(urls.app).host) return res.sendStatus(404);
  next();
}
function ownSession(req, res, next) {
  if (!req.session || req.authType === 'api_token' || req.securityContext?.impersonation || req.securityContext?.breakGlass || req.actorUser) {
    return res.status(403).json({ message: 'Use your own staff sign-in to manage attendance phones.' });
  }
  next();
}
// Keep these outside public/: the portal static handler also decodes encoded paths.
portal.get('/qr-staff/approve.js', portalOnly, privatePage, sendFile(path.join(viewsDir, 'approve.js')));
portal.get('/qr-staff/site.css', portalOnly, privatePage, sendFile(path.join(viewsDir, 'site.css')));
portal.use('/qr-staff', (_req, res) => res.sendStatus(404));
portal.get('/attendance/link-phone', portalOnly, privatePage, requireEnabled, pageAuth(), sendFile(path.join(viewsDir, 'approve.html')));
portal.post('/attendance/link-phone', portalOnly, privatePage, requireEnabled, appPost, enrolLimit, auth, ownSession,
  bodyContract(['challenge'], { required: ['challenge'] }), asyncRoute(async (req, res) => {
    const { code } = await phone.issueHandoff({ userId: req.user.id, challenge: req.body.challenge });
    const callback = new URL('/setup', qrStaffOrigin());
    callback.hash = new URLSearchParams({ code }).toString();
    res.json({ url: callback.href });
  }), failure);
portal.post('/attendance/phones/revoke-all', portalOnly, privatePage, requireEnabled, appPost, enrolLimit, auth, ownSession, emptyBody, asyncRoute(async (req, res) => {
  await phone.revokeAll(req.user.id);
  res.json({ ok: true });
}), failure);

module.exports = { host, portal };
