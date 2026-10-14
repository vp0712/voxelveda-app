'use strict';
// Actual before/after product assets, real cookie/JWT page and API authentication,
// and the application CSP. Every identity, session and API record is synthetic.
// Run only on the disposable local fixture server; no production account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require(process.env.VV_BROWSER_MODULE_PATH || 'playwright');
const project = path.resolve(__dirname, '..');
const baselineRef = process.env.VV_STAFF_BASELINE_REF || '616f8ee9e5d54af1201389ca1b7690a66163d0ad';
assert(/^[a-f0-9]{40}$/.test(baselineRef), 'Before screenshots require an exact preserved Git commit.');
const selectedPhase = process.env.VV_STAFF_PROOF_PHASE || 'both';
assert(['before', 'after', 'both'].includes(selectedPhase), 'Choose before, after or both for staff proof.');
const output = process.env.UI_PROOF_DIR || path.join(os.tmpdir(), 'voxelveda-staff-mobile-proof');
const identities = new Map([
  [9401, { id: 9401, name: 'Synthetic Staff Fixture', username: 'synthetic.staff', email: 'synthetic-staff@example.invalid', role: 'staff', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET', 'attendance_qr_bypass'] }],
  [9402, { id: 9402, name: 'Synthetic Other Fixture', username: 'synthetic.other', email: 'synthetic-other@example.invalid', role: 'staff', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET'] }],
  [9403, { id: 9403, name: 'Synthetic Directory Reviewer', username: 'synthetic.directory', email: 'synthetic-directory@example.invalid', role: 'integration_fixture', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: ['VIEW_STAFF_HR'] }]
]);
for(const [i,role]of ['manager','supervisor','hr','production','sales'].entries())identities.set(9404+i,{id:9404+i,name:'Synthetic '+role,username:'synthetic.'+role,email:'synthetic-'+role+'@example.invalid',role,active:1,account_status:'ACTIVE',session_version:1,mfa_enabled:0,permissions:[]});
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.SHIFT_QR_SIGNING_KEY = crypto.randomBytes(48).toString('hex');
process.env.RATE_LIMIT_STORE = 'memory';
process.env.MFA_REQUIRED_ROLES = 'super_admin,admin';
const sessions = new Map(), requests = [], mutations = [];
const userSession = id => {
  const token = jwt.sign({ id, role: 'staff' }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });
  sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { id: `synthetic-${id}`, user_id: id, session_version: 1, assurance_level: 1 });
  return token;
};
const query = async (sql, parameters = []) => {
  if (/FROM users\s+WHERE id\s*=\s*\?/i.test(String(sql))) return [[identities.get(Number(parameters[0]))].filter(Boolean), []];
  if (/FROM privileged_access_requests/i.test(String(sql))) return [[], []];
  throw new Error('Unexpected authentication SQL in browser fixture: ' + String(sql).replace(/\s+/g, ' '));
};
const originalLoad = Module._load;
Module._load = function fixtureLoad(request, parent) {
  const target = request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request).replace(/\.js$/, '') : request;
  if (target === path.join(project, 'config/db')) return { query };
  if (target === path.join(project, 'services/userLifecycleService')) return { ensureUserLifecycleSchema: async () => {} };
  if (target === path.join(project, 'services/securitySchema')) return { ensureSecuritySchema: async () => {} };
  if (target === path.join(project, 'services/sessionService')) return {
    validateSession: async (token, decoded) => {
      const saved = sessions.get(crypto.createHash('sha256').update(token).digest('hex'));
      return saved && Number(saved.user_id) === Number(decoded.id) ? saved : null;
    },
    logSecurityEvent: async () => {}
  };
  if (target === path.join(project, 'services/securityContextService')) return {
    loadBreakGlassPermissions: async () => ({ permissions: [], requestIds: [] }),
    resolveImpersonation: async () => null, parseJsonArray: value => Array.isArray(value) ? value : []
  };
  return originalLoad.apply(this, arguments);
};
let auth, pageAuth, security, brand, authController;
try {
  auth = require('../middleware/auth'); pageAuth = require('../middleware/pageAuth');
  authController = require('../controllers/authController');
  security = require('../middleware/securityMiddleware'); brand = require('../services/globalBrandRenderer');
} finally { Module._load = originalLoad; }

function resetState() {
  return {
    photo: false, photoFailure: false,
    notifications: Array.from({ length: 36 }, (_, index) => ({
      id: 9801 + index, user_id: 9401, type: 'synthetic_test', category: index % 3 ? 'TASKS' : 'SYSTEM',
      title: `Synthetic ${index % 3 ? 'task update' : 'system update'} ${index + 1}: a longer notification title for narrow screens`,
      message: 'Synthetic fixture record. Review this supported item and its current status before continuing.',
      priority: index % 7 === 0 ? 'HIGH' : 'NORMAL', linked_module: index % 3 ? 'TASKS' : 'SYSTEM',
      linked_record_id: String(index + 1), action_url: index === 0 ? '/portal/staff?view=tasks' : null,
      is_read: index > 23 ? 1 : 0, created_at: new Date(Date.now() - index * 60000).toISOString()
    })),
    attendance: null, actionResults: new Map(), receiptRequests: [], timeline: [], breakStart: null,
    serverNow: new Date('2026-10-13T00:00:00Z'), loseNextActionReply: false, corrections: [], correctionRequests: [], qrValidationRequests: [], delayedReplies: new Map(), directoryPhotoRequests: []
  };
}
function attendanceState(state, userId = 9401) {
  const row = state.attendance?.user_id === userId ? state.attendance : null;
  const open = row && !row.clock_out, onBreak = open && Boolean(state.breakStart);
  const ongoingBreak = onBreak ? Math.floor((state.serverNow - state.breakStart) / 60000) : 0;
  const live = open ? Math.floor((state.serverNow - new Date(row.clock_in)) / 60000) - row.break_minutes - ongoingBreak : 0;
  const active = open ? { ...row, live_worked_minutes: live, live_break_minutes: ongoingBreak, recorded_break_minutes: row.break_minutes, overnight: false, allocated_work_date: row.work_date } : null;
  return { profile: { id: userId, name: identities.get(userId).name, department: 'Synthetic verification team' }, attendance: active || row, sessions: row ? [{ ...row }] : [], status: open ? onBreak ? 'ON_BREAK' : 'WORKING' : row ? 'COMPLETED' : 'NOT_STARTED',
    active_attendance: active, completed_attendance_id: row?.clock_out ? row.id : null,
    company_timezone: 'Australia/Sydney', work_date: '2026-10-13', server_time: state.serverNow.toISOString(),
    summary: { first_check_in: row?.clock_in || null, latest_check_out: row?.clock_out || null, break_recording_status: row ? 'RECORDED' : 'NOT_RECORDED', recorded_break_session_count: row ? 1 : 0, worked_minutes: row?.clock_out ? row.total_minutes : 0, live_worked_minutes: live, recorded_break_minutes: row?.break_minutes || 0, live_break_minutes: ongoingBreak, session_count: row ? 1 : 0, eligible_session_count: row?.clock_out ? 1 : 0, duplicate_session_count: 0, review_required: false },
    timeline: row ? state.timeline.map(event => ({ ...event, verification_status: 'VERIFIED' })) : [], next_roster: null, tasks: [], categories: [], qr_required: userId !== 9401,
    allowed_actions: open ? ['CHECK_OUT', onBreak ? 'BREAK_END' : 'BREAK_START'] : ['CHECK_IN'],
    break_policy: { mode: 'RECORDED_ACTUAL', automatic_deduction: false }, reporting_basis: 'WHOLE_SHIFT_LOCAL_START_DATE', review_issues: [] };
}
function holdNextReply(state, endpoint, userId) {
  let entered, release;
  const gate = { entered: new Promise(resolve => { entered = resolve; }), wait: new Promise(resolve => { release = resolve; }), release: () => release(), enter: payload => { gate.payload = payload; entered(); }, attempted: false };
  state.delayedReplies.set(`${endpoint}:${userId}`, gate);
  return gate;
}
async function deliverReply(state, req, res, payload) {
  // Capture the actual synthetic owner's response before withholding transport;
  // a switch never rewrites an old response to make the UI test pass.
  const captured = JSON.parse(JSON.stringify(payload)), key = `${req.path}:${Number(req.user.id)}`;
  const gate = state.delayedReplies.get(key);
  if (gate) { state.delayedReplies.delete(key); gate.enter(captured); await gate.wait; gate.attempted = true; }
  return res.json(captured);
}
async function makeServer(publicDirectory, photo) {
  let pageBrand=brand;if(publicDirectory!==path.join(project,'public')){const module={exports:{}};require('node:vm').runInNewContext(execFileSync('git',['show',baselineRef+':services/globalBrandRenderer.js'],{cwd:project,encoding:'utf8'}),{module,exports:module.exports});pageBrand=module.exports;}
  const state = resetState(), app = express();
  app.disable('x-powered-by'); app.use(security.securityHeaders); app.use(express.json()); app.use(security.csrfProtection);
  app.use((req, _res, next) => { requests.push({ path: req.path, method: req.method }); next(); });
  app.get('/login', (_req, res) => res.type('html').send('<!doctype html><title>Synthetic fixture sign in</title><h1>Sign in</h1>'));
  for (const [route, file] of [['/portal/staff', 'staff-dashboard.html'], ['/profile', 'profile.html'], ['/admin', 'admin-dashboard.html']]) {
    app.get(route, pageAuth(), (_req, res) => res.set('Cache-Control', 'private, no-store').type('html').send(pageBrand.injectGlobalBrand(fs.readFileSync(path.join(publicDirectory, file), 'utf8'))));
  }
  app.get('/synthetic-fixtures/avatar-observer', pageAuth(), (_req, res) => res.set('Cache-Control', 'private, no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic avatar observer fixture</title><script src="/profile-avatar.js" defer></script></head><body>
    <h1>Synthetic authorised directory component fixture</h1><p>Every account and photo outcome on this fixture is synthetic.</p>
    <div id="avatarObserverMissing" data-avatar-user-id="9401" data-avatar-name="Synthetic Staff Fixture"></div>
    <div id="avatarObserverFailed" data-avatar-user-id="9402" data-avatar-name="Synthetic Other Fixture"></div>
    <div id="avatarObserverInvalid" data-avatar-user-id="NaN" data-avatar-name="Synthetic malformed fixture"></div>
    <button id="avatarObserverResponsive" type="button">Check responsiveness</button><output id="avatarObserverClicks">0</output><div id="avatarObserverUnrelated"></div></body></html>`));
  app.post('/api/security/csp-report', (_req, res) => res.sendStatus(204));
  app.use('/api', auth);
  app.get('/api/auth/me', authController.me);
  app.get('/api/profile', (req, res) => {
    const user = identities.get(Number(req.user.id));
    const hasPhoto = state.photo && user.id === 9401;
    const revision = hasPhoto ? crypto.createHash('sha256').update(photo).digest('hex') : null;
    res.json({ profile: { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, active: true, account_status: 'ACTIVE', mobile_number: null, has_profile_photo: hasPhoto,
      profile_photo_mime: hasPhoto ? 'image/png' : null, profile_photo_size: hasPhoto ? photo.length : 0, profile_photo_revision: revision, profile_photo_url: hasPhoto ? `/api/profile/photo?v=${revision}` : null } });
  });
  app.get('/api/profile/photo', (req, res) => {
    if (Number(req.user.id) !== 9401 || !state.photo || state.photoFailure) return res.sendStatus(404);
    return res.set('Cache-Control', 'private, no-store').type('png').send(photo);
  });
  app.get('/api/profile/staff/:userId/photo', (req, res) => {
    const { hasAnyPermission } = require('../services/authorizationService');
    const target = Number(req.params.userId);
    if (!hasAnyPermission(req.user, ['MANAGE_USERS', 'VIEW_STAFF_HR']) || !identities.has(target)) return res.sendStatus(404);
    const status = target === 9401 ? 404 : 503;
    state.directoryPhotoRequests.push({ actor: Number(req.user.id), target, status });
    return res.set('X-Fixture-Expected', 'DIRECTORY_PHOTO_OUTCOME').status(status).json({ message: status === 404 ? 'Synthetic directory account has no photo' : 'Synthetic temporary photo failure' });
  });
  const own = req => state.notifications.filter(item => item.user_id === Number(req.user.id));
  const unread = req => own(req).filter(item => !item.is_read).length;
  app.get('/api/notifications/unread-count', (req, res) => res.json({ unread: unread(req) }));
  app.get('/api/notifications', (req, res) => {
    let items = own(req); if (req.query.tab === 'unread') items = items.filter(item => !item.is_read);
    if (req.query.tab === 'important') items = items.filter(item => item.priority === 'HIGH');
    if (req.query.category) items = items.filter(item => item.category === req.query.category);
    const page = Number(req.query.page || 1), limit = Math.min(100, Number(req.query.limit || 30));
    res.json({ notifications: items.slice((page - 1) * limit, page * limit), page, limit, total: items.length, pages: Math.ceil(items.length / limit), unread: unread(req) });
  });
  app.patch('/api/notifications/:id/:readState', (req, res) => {
    const item = own(req).find(row => row.id === Number(req.params.id)); if (!item) return res.sendStatus(404);
    item.is_read = req.params.readState === 'read' ? 1 : 0; mutations.push({ type: 'notification_read', id: item.id });
    return res.json({ message: 'Synthetic read state persisted', unread: unread(req) });
  });
  app.post('/api/notifications/mark-all-read', (req, res) => {
    own(req).forEach(item => { item.is_read = 1; }); mutations.push({ type: 'mark_all_read', user_id: Number(req.user.id) });
    res.json({ updated: own(req).length, unread: unread(req) });
  });
  app.post('/api/notifications/:id/open', (req, res) => {
    const item = own(req).find(row => row.id === Number(req.params.id)); if (!item) return res.sendStatus(404);
    item.is_read = 1; mutations.push({ type: 'notification_open', id: item.id });
    res.json({ notification: item, action_url: null, target_status: item.action_url ? 'UNAVAILABLE' : 'NONE', unread: unread(req), message: 'The synthetic target is unavailable.' });
  });
  app.get('/api/notifications/preferences', (_req, res) => res.json({ preferences: [] }));
  app.get('/api/attendance/today', (req, res) => deliverReply(state, req, res, attendanceState(state, Number(req.user.id))));
  app.post('/api/attendance/qr/validate', (req, res) => {
    const qr = require('../services/attendanceQrService'), now = new Date();
    state.qrValidationRequests.push({ action: req.body.action, user_id: Number(req.user.id) });
    try {
      qr.validateSiteToken(req.body.token, now);
      return res.json(qr.createActionProof({ userId: Number(req.user.id), action: req.body.action, attendanceId: req.body.attendance_id ?? null, priorAttendanceId: state.attendance?.id ?? null, siteToken: req.body.token, now }));
    } catch (error) {
      return res.set('X-Fixture-Expected', 'QR_REJECTED').status(error.statusCode || 403).json({ message: error.message, code: error.code, fields: error.fields, qr_required: true });
    }
  });
  app.get('/api/attendance/reconcile', (req, res) => {
    const receipt = state.actionResults.get(`${req.user.id}:${req.query.request_id}`);
    res.json({ found: Boolean(receipt), receipt: receipt?.response || null, state: attendanceState(state, Number(req.user.id)) });
  });
  app.post('/api/attendance/actions', async (req, res) => {
    const input = req.body, userId = Number(req.user.id), key = `${userId}:${input.request_id}`;
    assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.request_id));
    state.receiptRequests.push({ ...input, user_id: userId });
    const semantic = JSON.stringify([input.action, input.attendance_id ?? null]), prior = state.actionResults.get(key);
    if (prior) return prior.semantic === semantic ? res.json({ ...prior.response, existing: true, state: attendanceState(state, userId) }) : res.status(409).json({ code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT' });
    state.serverNow = new Date(state.serverNow.getTime() + 60000);
    const at = state.serverNow.toISOString();
    if (input.action === 'CHECK_IN') {
      if (!state.attendance || state.attendance.clock_out) state.attendance = { id: 9901, user_id: userId, clock_in: at, clock_out: null, work_date: '2026-10-13', timestamp_basis: 'UTC', clock_out_timestamp_basis: null, recorded_timezone: 'Australia/Sydney', entry_source: 'CLOCK', break_minutes: 0, total_minutes: 0, total_hours: 0, revision: 1, review_required: false };
    } else {
      if (!state.attendance || state.attendance.user_id !== userId || Number(input.attendance_id) !== state.attendance.id) return res.status(409).json({ code: 'ATTENDANCE_SESSION_CONFLICT' });
      if (input.action === 'BREAK_START') state.breakStart = state.serverNow;
      else if (input.action === 'BREAK_END') { state.attendance.break_minutes += Math.floor((state.serverNow - state.breakStart) / 60000); state.breakStart = null; }
      else if (input.action === 'CHECK_OUT') { state.attendance.clock_out = at; state.attendance.clock_out_timestamp_basis = 'UTC'; state.attendance.total_minutes = Math.floor((state.serverNow - new Date(state.attendance.clock_in)) / 60000) - state.attendance.break_minutes; state.attendance.total_hours = Math.round(state.attendance.total_minutes / 60 * 100) / 100; }
      else return res.status(422).json({ code: 'ATTENDANCE_ACTION_INVALID' });
      state.attendance.revision++;
    }
    state.timeline.push({ id: `${input.action}-${state.timeline.length}`, type: input.action, attendance_id: state.attendance.id, at, allocated_work_date: state.attendance.work_date });
    const response = { request_id: input.request_id, action: input.action, attendance_id: state.attendance.id, attendance: { ...state.attendance }, existing: false, unchanged: false };
    state.actionResults.set(key, { semantic, response });
    if (state.loseNextActionReply) { state.loseNextActionReply = false; return res.set('X-Fixture-Expected', 'COMMIT_REPLY_INTERRUPTED').status(503).json({ message: 'Synthetic commit reply interrupted; reconcile the original receipt.' }); }
    return deliverReply(state, req, res, { ...response, state: attendanceState(state, userId) });
  });
  app.post('/api/attendance/sessions/:id/note', (req, res) => {
    const row = state.attendance;
    if (!row || row.user_id !== Number(req.user.id) || row.id !== Number(req.params.id) || !row.clock_out) return res.sendStatus(404);
    if (Number(req.body.expected_revision) !== row.revision) return res.status(409).json({ code: 'ATTENDANCE_REVISION_CONFLICT' });
    row.notes = req.body.notes; row.revision++; mutations.push({ type: 'checkout_note', attendance_id: row.id });
    res.json({ request_id: req.body.request_id, attendance_id: row.id, attendance: { ...row }, state: attendanceState(state, Number(req.user.id)) });
  });
  app.get('/api/attendance/week', (req, res) => { const owned = attendanceState(state, Number(req.user.id)); return res.json({ attendance: owned.sessions, timesheet: null, total_hours: owned.summary.worked_minutes / 60 }); });
  app.get('/api/attendance/my', (req, res) => {
    const rows = state.attendance?.user_id === Number(req.user.id) ? [{ ...state.attendance }] : [];
    return deliverReply(state, req, res, { attendance: rows, timesheets: [], page: 1, page_size: 20, total: rows.length, pages: 1 });
  });
  app.get('/api/attendance/corrections', (req, res) => {
    if (req.query.scope && req.query.scope !== 'own') return res.sendStatus(403);
    const rows = state.corrections.filter(item => item.user_id === Number(req.user.id));
    res.json({ corrections: rows, scope: 'own', page: 1, page_size: 20, total: rows.length, pages: 1 });
  });
  app.post('/api/attendance/corrections', (req, res) => {
    const input = req.body;
    assert.equal(input.correction_type, 'MISSING_SESSION');
    assert(!Object.hasOwn(input, 'attendance_id') && !Object.hasOwn(input, 'expected_revision'), 'missing-session requests cannot replace an existing row');
    state.correctionRequests.push({ ...input, user_id: Number(req.user.id) });
    const prior = state.corrections.find(item => item.request_id === input.request_id && item.user_id === Number(req.user.id));
    if (prior) return res.json({ correction: prior, existing: true });
    const { DateTime } = require('luxon');
    const correction = { id: 9910, user_id: Number(req.user.id), request_id: input.request_id, correction_type: 'MISSING_SESSION', attendance_id: null, attendance_revision: null, revision: 1, status: 'PENDING', reason: input.reason,
      proposed: { clock_in: DateTime.fromISO(input.clock_in, { zone: 'Australia/Sydney' }).toUTC().toISO(), clock_out: DateTime.fromISO(input.clock_out, { zone: 'Australia/Sydney' }).toUTC().toISO(), break_minutes: input.break_minutes, notes: input.notes }, before: null, can_review: false };
    state.corrections.push(correction); mutations.push({ type: 'missing_session_request', id: correction.id });
    return res.json({ correction, existing: false });
  });
  app.get('/api/roster/my', (_req, res) => res.json({ roster: [], shifts: [] }));
  app.get('/api/tasks/my', (_req, res) => res.json({ tasks: [] }));
  app.get('/api/tasks/announcements/my', (_req, res) => res.json({ announcements: [] }));
  app.get('/api/tasks/workhub', (_req, res) => res.json({ leave_requests: [], availability: [], documents: [], forms: [], messages: [] }));
  app.get('/api/tasks/messages/my', (_req, res) => res.json({ messages: [] }));
  app.get('/api/meetings/my', (_req, res) => res.json({ meetings: [] }));
  app.get('/api/compliance', (_req, res) => res.json({ entries: [], files: [] }));
  app.get('/api/auth/mfa/status', (_req, res) => res.json({ enabled: false, required: false }));
  app.get('/api/auth/sessions', (_req, res) => res.json({ sessions: [{ id: 'synthetic-browser', current: true }] }));
  app.use('/api', (req, res) => res.status(501).json({ code: 'UNEXPECTED_FIXTURE_API', path: req.path }));
  app.use(express.static(publicDirectory, { index: false }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.ALLOWED_ORIGINS = [...new Set([...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean), origin])].join(',');
  return { server, state, origin };
}

async function verifyEmulatedCameraCases(browser, fixture) {
  // These checks exercise the real scanner and staff confirmation UI. Device
  // capture and decoded-token input are emulated; native camera/QR recognition
  // is not claimed. Signature, expiry and site responses use the real service.
  const qr = require('../services/attendanceQrService'), results = [];
  const scenarios = [
    { name: 'permission-denied', mode: 'denied', message: 'Camera permission was denied', calls: 1 },
    { name: 'camera-not-found', mode: 'unavailable', message: 'No camera is available', calls: 2 },
    { name: 'media-api-unavailable', mode: 'unsupported', message: 'Camera scanning is unavailable', calls: 0 },
    { name: 'decoder-unavailable', mode: 'decoder-unavailable', message: 'camera or QR decoder is unavailable', calls: 1, tracks: 1 },
    { name: 'allowed-camera-close', mode: 'no-token', calls: 1, tracks: 1 },
    { name: 'allowed-valid-signed-token', mode: 'token', token: () => qr.createSiteToken(new Date()).qr_data, calls: 1, tracks: 1, valid: true },
    { name: 'invalid-signed-token', mode: 'token', token: () => 'synthetic-invalid-signed-token', calls: 1, tracks: 1, code: 'ATTENDANCE_QR_INVALID' },
    { name: 'expired-signed-token', mode: 'token', token: () => qr.createSiteToken(new Date(Date.now() - 120000)).qr_data, calls: 1, tracks: 1, code: 'ATTENDANCE_QR_EXPIRED' },
    { name: 'wrong-site-signed-token', mode: 'token', token: () => {
      const previous = process.env.SHIFT_QR_SITE_ID;
      try { process.env.SHIFT_QR_SITE_ID = 'synthetic-different-attendance-site'; return qr.createSiteToken(new Date()).qr_data; }
      finally { if (previous === undefined) delete process.env.SHIFT_QR_SITE_ID; else process.env.SHIFT_QR_SITE_ID = previous; }
    }, calls: 1, tracks: 1, code: 'ATTENDANCE_QR_WRONG_SITE' },
    { name: 'permission-result-after-close', mode: 'late', calls: 1, tracks: 1 }
  ];
  for (const scenario of scenarios) {
    Object.assign(fixture.state, resetState());
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    context.setDefaultTimeout(12000);
    await context.addCookies([{ name: 'vv_session', value: userSession(9402), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(), errors = [], qrResponses = [], reads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/attendance/qr/validate') reads.push(response.json().then(body => { qrResponses.push({ status: response.status(), code: body.code || null, valid: body.valid === true }); }));
    });
    try {
      await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' });
      await page.locator('#staffHomePrimaryAction:not([disabled])').waitFor();
      await page.evaluate(({ mode, decodedToken }) => {
        const state = window.__emulatedAttendanceCamera = { calls: 0, stops: 0, tracks: [], decoded: 0, release: null };
        if (mode === 'unsupported') Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
        else Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
          async getUserMedia() {
            state.calls++;
            if (mode === 'denied') throw new DOMException('Synthetic camera permission denial', 'NotAllowedError');
            if (mode === 'unavailable') throw new DOMException('Synthetic camera not found', 'NotFoundError');
            const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
            const drawing = canvas.getContext('2d'); drawing.fillStyle = '#165b82'; drawing.fillRect(0, 0, 64, 64);
            const stream = canvas.captureStream(5);
            drawing.fillRect(0, 0, 64, 64); stream.getVideoTracks().forEach(track => track.requestFrame?.());
            for (const track of stream.getTracks()) {
              const stop = track.stop.bind(track); track.stop = () => { state.stops++; stop(); }; state.tracks.push(track);
            }
            if (mode === 'late') return new Promise(resolve => { state.release = () => resolve(stream); });
            return stream;
          }
        } });
        window.getShiftQrDecoder = async () => {
          if (mode === 'decoder-unavailable') throw new Error('Synthetic decoder unavailable');
          return { type: 'emulated-token-input' };
        };
        if (mode === 'decoder-unavailable') window.jsQR = undefined;
        window.loadExternalScript = async () => { throw new Error('External decoder is unavailable in this device emulation'); };
        window.detectShiftQr = async () => { state.decoded++; return mode === 'token' ? decodedToken : null; };
      }, { mode: scenario.mode, decodedToken: scenario.token?.() || null });
      assert.equal(fixture.state.receiptRequests.length, 0);
      await page.locator('#staffHomePrimaryAction').click();
      await page.locator('#staffAttendanceOverlay').waitFor({ state: 'visible' });
      if (scenario.message) await page.locator('#staffAttendanceScanStatus').filter({ hasText: scenario.message }).waitFor();
      else if (scenario.valid) await page.locator('#staffAttendanceConfirm').waitFor();
      else if (scenario.code) {
        await page.waitForFunction(() => document.getElementById('staffAttendanceScanStatus')?.getAttribute('data-error') === 'true');
        const message = await page.locator('#staffAttendanceScanStatus').textContent();
        assert(message.includes('No attendance was changed.'));
        if (scenario.code === 'ATTENDANCE_QR_EXPIRED') assert(message.includes('expired'));
        if (scenario.code === 'ATTENDANCE_QR_WRONG_SITE') assert(message.includes('different attendance site'));
        if (scenario.code === 'ATTENDANCE_QR_INVALID') assert(message.includes('current workplace QR'));
      }
      else if (scenario.mode === 'late') await page.waitForFunction(() => window.__emulatedAttendanceCamera?.calls === 1);
      else await page.waitForFunction(() => document.getElementById('staffAttendanceVideo')?.readyState >= 2 && window.__emulatedAttendanceCamera?.decoded > 0);
      assert.equal(fixture.state.receiptRequests.length, 0, 'Opening camera, decoding and QR verification cannot clock a user in.');
      if (!scenario.valid) assert.equal(await page.locator('#staffAttendanceConfirm').count(), 0, 'A failed or unfinished scan cannot enable confirmation.');
      if (scenario.valid) await page.locator('#staffAttendanceCancel').click();
      else await page.locator('#staffAttendanceScanCancel').click();
      if (scenario.mode === 'late') await page.evaluate(() => window.__emulatedAttendanceCamera.release());
      await page.locator('#staffAttendanceOverlay').waitFor({ state: 'hidden' });
      if (scenario.tracks) await page.waitForFunction(() => window.__emulatedAttendanceCamera.tracks.every(track => track.readyState === 'ended'));
      const device = await page.evaluate(() => ({ calls: window.__emulatedAttendanceCamera.calls, stopped: window.__emulatedAttendanceCamera.stops, tracks: window.__emulatedAttendanceCamera.tracks.length, states: window.__emulatedAttendanceCamera.tracks.map(track => track.readyState) }));
      assert.equal(device.calls, scenario.calls); assert.equal(device.tracks, scenario.tracks || 0); assert.equal(device.stopped, scenario.tracks || 0);
      await Promise.all(reads);
      if (scenario.code) { assert.equal(qrResponses.length, 1); assert.equal(qrResponses[0].code, scenario.code); assert.equal(qrResponses[0].status, 403); }
      else if (scenario.valid) { assert.deepEqual(qrResponses, [{ status: 200, code: null, valid: true }]); }
      else assert.deepEqual(qrResponses, []);
      assert.equal(fixture.state.receiptRequests.length, 0); assert.equal(fixture.state.attendance, null);
      assert.deepEqual(errors, []);
      results.push({ scenario: scenario.name, hardwareEmulated: true, nativeHardwareVerified: false, device, qrResponses, actionsPosted: 0 });
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'scanner-' + scenario.name + '-failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
      throw new Error('Emulated camera scenario failed: ' + scenario.name, { cause: error });
    } finally { await context.close(); }
  }
  return results;
}
async function verifyResponsiveStaffMatrix(browser, fixture) {
  const results = [], viewports = [...[320,360,390,430,768,1024,1440].map(width=>({name:'width-'+width,width,height:844})),{name:'phone-landscape',width:844,height:390}];
  const scope = 'After product staff DOM, canonical synthetic owner/photo and notifications; seven required widths plus landscape in the existing light/dark preference. Attendance writes are covered separately.';
  for (const viewport of viewports) for (const mode of ['light','dark']) {
    Object.assign(fixture.state, resetState()); fixture.state.photo = true;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' }); context.setDefaultTimeout(12000);
    await context.addCookies([{ name: 'vv_session', value: userSession(9401), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(), errors = [], apiFailures = [];
    const name = viewport.name + '-' + mode;
    let beforeOverlay = null, restored = null, overlayTrace = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { const pathname = new URL(response.url()).pathname; if (pathname.startsWith('/api/') && response.status() >= 400) apiFailures.push({ path: pathname, status: response.status() }); });
    await page.addInitScript(preference => {
      localStorage.setItem('voxelveda:color-mode', preference); window.__matrixOverlayTrace = [];
      const record = event => {
        if (window.__matrixOverlayTrace.length >= 100) return;
        window.__matrixOverlayTrace.push({ type: event.type, at: Math.round(performance.now()), target: event.target?.closest?.('button')?.id || event.target?.id || null,
          activeElement: document.activeElement?.id || null, scrollX, scrollY, overlay: window.VoxelOverlay?.active || null,
          brandBusy: document.body?.classList.contains('vv-brand-busy') || false, overflow: document.body?.style.overflow || '', id: event.detail?.id || null });
      };
      for (const type of ['pointerdown','mousedown','focusin','click']) document.addEventListener(type, record, true);
      for (const type of ['vv:overlay-open','vv:overlay-closed']) window.addEventListener(type, record);
    }, mode);
    try {
      const response = await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'domcontentloaded' }); assert.equal(response.status(), 200);
      await page.locator('#staffHomePrimaryAction:not([disabled])').waitFor();
      await page.waitForFunction(() => window.VoxelStaffHome.state?.profile?.id === 9401 && document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Staff Fixture') && document.querySelector('#sidebarAvatar img')?.naturalWidth > 0 && !document.querySelector('#sidebarAvatar img')?.hidden);
      await page.waitForFunction(() => { const loader = document.getElementById('vvGlobalBrandLoader'); return document.readyState === 'complete' && loader && !loader.classList.contains('is-visible') && loader.getAttribute('aria-hidden') === 'true' && !document.body.classList.contains('vv-brand-busy'); });
      const me = await context.request.get(fixture.origin + '/api/auth/me'); assert.equal(me.status(), 200); assert.equal(Number((await me.json()).user.id), 9401);
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('.staff-mobile-bottom-nav'), photo = document.querySelector('#sidebarAvatar img');
        return { theme: document.documentElement.dataset.colorMode, owner: window.VoxelStaffHome.state.profile.id,
          width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, photoLoaded: Boolean(photo && !photo.hidden && photo.naturalWidth > 0),
          mobileNavVisible: Boolean(nav && getComputedStyle(nav).display !== 'none'),
          nav: [...(nav?.querySelectorAll('button') || [])].filter(button => getComputedStyle(button).display !== 'none').map(button => {
            const box = button.getBoundingClientRect(), style = getComputedStyle(button);
            return { label: button.textContent.trim(), width: box.width, height: box.height, fontSize: style.fontSize, textOverflow: style.textOverflow,
              clientWidth: button.clientWidth, scrollWidth: button.scrollWidth, clientHeight: button.clientHeight, scrollHeight: button.scrollHeight };
          }) };
      });
      assert.equal(layout.theme, mode); assert.equal(layout.owner, 9401); assert.equal(layout.photoLoaded, true);
      assert(layout.scrollWidth <= layout.width, 'Staff home must fit ' + name + ' without horizontal overflow.');
      if (viewport.width < 1024) {
        assert.equal(layout.mobileNavVisible, true); assert.deepEqual(layout.nav.map(button => button.label), ['Home','Shifts','Timesheets','Tasks','Profile']);
        for (const button of layout.nav) {
          assert(button.width >= 44 && button.height >= 44, name + ': ' + button.label + ' must retain a 44px touch target.');
          assert.notEqual(button.textOverflow, 'ellipsis', name + ': the complete ' + button.label + ' label must be readable.');
          assert(button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1, name + ': ' + button.label + ' text must fit its actual button.');
          assert(!button.label.includes('…') && !button.label.includes('...'));
        }
      } else assert.equal(layout.mobileNavVisible, false);
      await page.screenshot({ path: path.join(output, 'after-responsive-' + name + '-home.png'), animations: 'disabled' });
      await page.evaluate(() => window.scrollTo({ left: 0, top: Math.min(80, Math.max(0, document.documentElement.scrollHeight - innerHeight)), behavior: 'instant' }));
      await page.locator('#staffNotificationBell').scrollIntoViewIfNeeded();
      beforeOverlay = await page.evaluate(async () => {
        let stable = 0, lastX = scrollX, lastY = scrollY;
        for (let frame = 0; frame < 120; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          stable = scrollX === lastX && scrollY === lastY ? stable + 1 : 0; lastX = scrollX; lastY = scrollY;
          if (stable >= 3) return { scrollX, scrollY, overflow: document.body.style.overflow, overscroll: document.body.style.overscrollBehavior };
        }
        throw new Error('The preparatory staff page scroll did not settle before opening notifications.');
      });
      const bell = await page.locator('#staffNotificationBell').boundingBox();
      assert(bell, 'The loaded staff notification bell must have a real visible box.');
      const pointer = { x: bell.x + bell.width / 2, y: bell.y + bell.height / 2 };
      assert(pointer.x >= 0 && pointer.y >= 0 && pointer.x < viewport.width && pointer.y < viewport.height);
      assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('#staffNotificationBell')?.id || null, pointer), 'staffNotificationBell', 'The actual pointer must hit the unobstructed visible bell.');
      // Locator.click performs an additional automatic scroll before real input.
      // A physical click at this hit-tested point preserves the settled origin.
      await page.mouse.click(pointer.x, pointer.y); await page.locator('#staffNotificationPanel').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelectorAll('#staffNotificationPanel [data-notification-id]').length > 0);
      const panel = await page.locator('#staffNotificationPanel').boundingBox();
      assert(panel.x >= -1 && panel.y >= -1 && panel.x + panel.width <= viewport.width + 1 && panel.y + panel.height <= viewport.height + 1, 'Notification panel must fit ' + name + '.');
      const panelStyle = await page.locator('#staffNotificationPanel').evaluate(target => ({ background: getComputedStyle(target).backgroundColor, color: getComputedStyle(target).color, scrollWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }));
      assert(panelStyle.scrollWidth <= panelStyle.viewportWidth, 'Opening notifications cannot add horizontal overflow.');
      await page.screenshot({ path: path.join(output, 'after-responsive-' + name + '-notifications.png'), animations: 'disabled' });
      await page.keyboard.press('Escape'); await page.locator('#staffNotificationPanel').waitFor({ state: 'hidden' });
      restored = await page.evaluate(() => ({ activeElement: document.activeElement?.id, scrollX, scrollY, overflow: document.body.style.overflow, overscroll: document.body.style.overscrollBehavior, overlayOpen: document.body.classList.contains('vv-overlay-open') }));
      assert.equal(restored.activeElement, 'staffNotificationBell'); assert.equal(restored.overlayOpen, false);
      assert.equal(restored.overflow, beforeOverlay.overflow); assert.equal(restored.overscroll, beforeOverlay.overscroll);
      assert.equal(restored.scrollX, beforeOverlay.scrollX); assert(Math.abs(restored.scrollY - beforeOverlay.scrollY) <= 1, 'Escape must preserve the underlying staff page scroll position.');
      assert.deepEqual(errors, []); assert.deepEqual(apiFailures, []); assert.equal(fixture.state.receiptRequests.length, 0);
      overlayTrace = await page.evaluate(() => window.__matrixOverlayTrace || []);
      const down = overlayTrace.find(event => event.type === 'pointerdown' && event.target === 'staffNotificationBell');
      const closed = overlayTrace.find(event => event.type === 'vv:overlay-closed' && event.id === 'notifications');
      assert(down && closed, 'The real pointer and overlay close must appear in the trace.');
      assert.equal(down.scrollX, beforeOverlay.scrollX); assert.equal(down.scrollY, beforeOverlay.scrollY, 'Real pointer input must begin at the settled staff page position.');
      assert.equal(closed.scrollX, beforeOverlay.scrollX); assert.equal(closed.scrollY, beforeOverlay.scrollY, 'The real overlay close must preserve that same position.');
      results.push({ fixtureOnly: true, viewport, mode, canonicalOwner: 9401, visibleAppReady: true, layout, panel, panelStyle, beforeOverlay, restored, overlayTrace, attendanceWrites: 0 });
      fs.writeFileSync(path.join(output, 'staff-responsive-matrix.json'), JSON.stringify({ fixtureOnly: true, scope, complete: results.length === viewports.length*2, results }, null, 2));
    } catch (error) {
      overlayTrace = await page.evaluate(() => window.__matrixOverlayTrace || []).catch(() => []);
      const uiState = await page.evaluate(() => ({ path: location.pathname, theme: document.documentElement.dataset.colorMode, owner: window.VoxelStaffHome?.state?.profile?.id || null,
        brandBusy: document.body.classList.contains('vv-brand-busy'), loaderVisible: document.getElementById('vvGlobalBrandLoader')?.classList.contains('is-visible') || false,
        homeError: document.getElementById('staffHomeErrorText')?.textContent || null, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollX, scrollY },
        nav: [...document.querySelectorAll('.staff-mobile-bottom-nav button')].map(button => ({ label: button.textContent, textOverflow: getComputedStyle(button).textOverflow, fontSize: getComputedStyle(button).fontSize, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth })) })).catch(() => null);
      fs.writeFileSync(path.join(output, 'staff-responsive-matrix-failure.json'), JSON.stringify({ fixtureOnly: true, scope, viewport, mode, message: error.message, beforeOverlay, restored, overlayTrace, uiState, errors, apiFailures, completed: results }, null, 2));
      await page.screenshot({ path: path.join(output, 'responsive-' + name + '-failure.png'), animations: 'disabled', timeout: 5000 }).catch(() => {});
      throw new Error('Actual staff responsive matrix failed: ' + name, { cause: error });
    } finally { await context.close(); }
  }
  return { scope, results };
}

async function verifyDecoderProviderRetry(browser, fixture) {
  Object.assign(fixture.state, resetState());
  const provider = fixture.origin + '/vendor/jsQR.js';
  const token = require('../services/attendanceQrService').createSiteToken(new Date()).qr_data;
  const branded = await require('../services/attendanceQrRenderer').renderAttendanceQr(token);
  const cameraImage = 'data:image/png;base64,' + branded.buffer.toString('base64');
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' }); context.setDefaultTimeout(12000);
  await context.addCookies([{ name: 'vv_session', value: userSession(9402), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
  let providerRequests = 0;
  await context.route(provider, async route => {
    providerRequests++;
    if (providerRequests === 1) return route.fulfill({ status: 503, contentType: 'application/javascript', body: '// Synthetic decoder provider unavailable.' });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(project,'node_modules/jsqr/dist/jsQR.js'),'utf8') });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { delete window.BarcodeDetector; if ('BarcodeDetector' in window) throw new Error('Synthetic decoder fixture could not disable the native detector.'); });
  try {
    await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' }); await page.locator('#staffHomePrimaryAction:not([disabled])').waitFor();
    await page.evaluate(({providerUrl,cameraImage}) => {
      const state = window.__realDecoderRetry = { calls: 0, stops: 0, tracks: [], unrelated: [...document.scripts].filter(script => script.src !== providerUrl) };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia() {
        state.calls++; const image=new Image();image.src=cameraImage;await image.decode();const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const drawing = canvas.getContext('2d');drawing.drawImage(image,0,0);
        const stream = canvas.captureStream(5);drawing.drawImage(image,0,0);
        for (const track of stream.getTracks()) { track.requestFrame?.(); const stop = track.stop.bind(track); track.stop = () => { state.stops++; stop(); }; state.tracks.push(track); }
        return stream;
      } } });
    }, {providerUrl:provider,cameraImage});
    await page.locator('#staffHomePrimaryAction').click();
    await page.waitForFunction(() => document.getElementById('staffAttendanceScanStatus')?.dataset.error === 'true');
    const firstMessage = await page.locator('#staffAttendanceScanStatus').textContent();
    assert(firstMessage.includes('decoder is unavailable') && firstMessage.includes('No attendance was changed.'));
    assert.equal(providerRequests, 1, 'A provider failure must wait for explicit user retry rather than immediately loading a second script.');
    assert.equal(fixture.state.receiptRequests.length, 0); assert.equal(fixture.state.qrValidationRequests.length, 0);
    assert.equal(await page.locator('#staffAttendanceConfirm').count(), 0);
    await page.waitForFunction(() => window.__realDecoderRetry.tracks.length === 1 && window.__realDecoderRetry.tracks[0].readyState === 'ended');
    await page.locator('#staffAttendanceCameraRetry').click(); await page.locator('#staffAttendanceConfirm').waitFor();
    assert.equal(providerRequests, 2, 'Explicit retry must recover the real cached decoder promise and request one fresh provider script.');
    assert.equal(fixture.state.qrValidationRequests.length, 1); assert.equal(fixture.state.qrValidationRequests[0].user_id, 9402);
    assert.equal(fixture.state.receiptRequests.length, 0, 'Successful camera/provider retry and QR verification still require explicit attendance confirmation.');
    await page.locator('#staffAttendanceConfirm').click();await page.waitForFunction(()=>window.VoxelStaffHome?.state?.status==='WORKING');await page.locator('#staffAttendanceOverlay').waitFor({ state: 'hidden' });
    assert.equal(fixture.state.receiptRequests.length,1);assert.equal(fixture.state.attendance.user_id,9402);
    const final = await page.evaluate(providerUrl => ({ calls: window.__realDecoderRetry.calls, stops: window.__realDecoderRetry.stops,
      states: window.__realDecoderRetry.tracks.map(track => track.readyState), unrelatedPreserved: window.__realDecoderRetry.unrelated.every(script => script.isConnected),
      providerScripts: [...document.scripts].filter(script => script.src === providerUrl).map(script => script.dataset.decoderLoadState) }), provider);
    assert.deepEqual(final, { calls: 2, stops: 2, states: ['ended','ended'], unrelatedPreserved: true, providerScripts: ['loaded'] });
    assert.deepEqual(errors, []);assert.ok(fixture.state.attendance);
    return { hardwareEmulated: true, decoderProviderEmulated: false, nativeQrRecognitionVerified: false, realBrandedGateImageDecoded:true,realLoaderAndScanner: true, providerRequests, firstMessage, final, actionsPosted: 1,fixturePersistenceConfirmed:true };
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'decoder-provider-retry-failure.png'), fullPage: true, animations: 'disabled', timeout: 5000 }).catch(() => {});
    throw new Error('Actual decoder provider and camera retry scenario failed', { cause: error });
  } finally { await context.close(); }
}

async function verifyCameraUrlIntent(browser,fixture){
  const results=[];
  for(const expired of [false,true]){
    Object.assign(fixture.state,resetState());const context=await browser.newContext({viewport:{width:390,height:844}});context.setDefaultTimeout(12000);await context.addCookies([{name:'vv_session',value:userSession(9402),url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
    try{const issued=require('../services/attendanceQrService').createSiteToken(new Date(Date.now()-(expired?120000:0))),intent=new URL(issued.qr_data).searchParams.get('t'),page=await context.newPage();await page.goto(fixture.origin+'/portal/staff?attendance_intent='+encodeURIComponent(intent));
      if(expired){await page.waitForFunction(()=>document.getElementById('staffAttendanceScanStatus')?.dataset.error==='true');assert.match(await page.locator('#staffAttendanceScanStatus').textContent(),/expired/i);assert.equal(await page.locator('#staffAttendanceConfirm').count(),0);}
      else{await page.locator('#staffAttendanceConfirm').waitFor();assert.equal(fixture.state.qrValidationRequests.length,1);await page.locator('#staffAttendanceCancel').click();}
      assert.equal(new URL(page.url()).searchParams.has('attendance_intent'),false);assert.equal(fixture.state.receiptRequests.length,0);results.push({expired,intentRevalidated:true,urlCleared:true,attendanceWrites:0});
    }finally{await context.close();}
  }
  return results;
}

async function verifyRoleHomes(browser,fixture){
  const results=[];
  for(const id of [9402,9404,9405,9406,9407,9408]){
    Object.assign(fixture.state,resetState());const context=await browser.newContext({viewport:{width:390,height:844}});context.setDefaultTimeout(12000);await context.addCookies([{name:'vv_session',value:userSession(id),url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
    try{const page=await context.newPage();await page.goto(fixture.origin+'/portal/staff',{waitUntil:'networkidle'});await page.waitForFunction(expected=>window.VoxelStaffHome?.state?.profile?.id===expected,id);const role=identities.get(id).role,labels=await page.locator('#staffRoleWork button').allTextContents();if(role==='staff')assert.equal(await page.locator('#staffRoleWork').isVisible(),false);else assert.ok(labels.length>0,role+' must have a focused permitted home');assert.equal(await page.locator('button:has-text("Create kiosk link")').count(),0);await page.screenshot({path:path.join(output,'after-role-'+role+'-phone.png'),fullPage:true});results.push({role,labels,ownAttendanceUser:id,managementGateNotExposed:true});}
    finally{await context.close();}
  }
  return results;
}

async function verifyDirectoryAvatarObserver(browser, fixture) {
  Object.assign(fixture.state, resetState());
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(12000); context.setDefaultNavigationTimeout(15000);
  await context.addCookies([{ name: 'vv_session', value: userSession(9403), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(), errors = [], photoResponses = [], responses = [], failedRequests = [], requestOffset = requests.length;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const item = { path: new URL(response.url()).pathname, status: response.status() }; responses.push(item);
    if (/^\/api\/profile\/staff\/[^/]+\/photo$/.test(item.path)) photoResponses.push(item);
  });
  page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText || null }));
  try {
    const me = await context.request.get(fixture.origin + '/api/auth/me'); assert.equal(me.status(), 200);
    const canonical = (await me.json()).user;
    assert.equal(Number(canonical.id), 9403); assert(canonical.permissions.includes('VIEW_STAFF_HR'), 'Directory fixture must hold the original global staff-photo permission.');
    await page.addInitScript(user => {
      localStorage.setItem('user', JSON.stringify(user));
      window.__avatarObserverProof = { mutations: 0, clicks: 0, frames: 0 };
      document.addEventListener('DOMContentLoaded', () => {
        // This is the real browser observer, alongside the unchanged component's
        // real observer. Record total activity before checking avatar changes.
        new MutationObserver(records => { window.__avatarObserverProof.mutations += records.length; }).observe(document.body, { childList: true, subtree: true });
        document.getElementById('avatarObserverResponsive').addEventListener('click', () => { document.getElementById('avatarObserverClicks').textContent = String(++window.__avatarObserverProof.clicks); });
      }, { once: true });
    }, canonical);
    // Await the document, then prove explicit component readiness and actual
    // frame/control responsiveness. HTTP quietness is not this regression's
    // readiness contract and cannot substitute for these DOM assertions.
    const response = await page.goto(fixture.origin + '/synthetic-fixtures/avatar-observer', { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200); assert(response.headers()['content-security-policy'].includes("default-src 'self'"));
    await page.waitForFunction(() => document.getElementById('avatarObserverMissing')?.dataset.avatarState === 'missing' && document.getElementById('avatarObserverFailed')?.dataset.avatarState === 'failed' && document.getElementById('avatarObserverInvalid')?.dataset.avatarState === 'missing');
    const stable = await page.evaluate(async () => {
      const targets = ['avatarObserverMissing', 'avatarObserverFailed', 'avatarObserverInvalid'].map(id => document.getElementById(id));
      const snapshot = () => targets.map(target => ({ id: target.id, state: target.dataset.avatarState, text: target.textContent, busy: target.getAttribute('aria-busy'), photoHidden: [...target.querySelectorAll('img')].every(image => image.hidden || !image.getAttribute('src')) }));
      const initial = snapshot(), changed = [];
      // Unrelated real DOM changes repeatedly invoke the shared mountAll path.
      // Cached 404/503 outcomes must never re-enter loading or flip text.
      const observer = new MutationObserver(records => changed.push(...records.map(record => record.target.parentElement?.id || record.target.id || 'child')));
      targets.forEach(target => observer.observe(target, { childList: true, subtree: true }));
      for (let index = 0; index < 12; index++) {
        document.getElementById('avatarObserverUnrelated').textContent = 'Synthetic unrelated DOM update ' + index;
        window.VoxelAvatar.mountAll();
        await new Promise(resolve => requestAnimationFrame(() => { window.__avatarObserverProof.frames++; resolve(); }));
        document.getElementById('avatarObserverResponsive').click();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect(); return { initial, final: snapshot(), avatarChildMutations: changed.length, observer: { ...window.__avatarObserverProof }, clicks: document.getElementById('avatarObserverClicks').textContent };
    });
    assert.deepEqual(stable.final, stable.initial, 'Real MutationObserver remounts leave settled directory initials and failure state unchanged.');
    assert.equal(stable.avatarChildMutations, 0, 'Cached missing/failed outcomes cannot cycle loading ellipses and initials.');
    assert.equal(stable.observer.frames, 12); assert.equal(stable.observer.clicks, 12); assert.equal(stable.clicks, '12');
    assert(stable.final.every(target => target.busy === 'false' && target.photoHidden && target.text !== '…'));
    assert(stable.observer.mutations < 100, 'Actual observer activity must remain bounded and allow scheduled frames and user controls.');
    assert.deepEqual([...fixture.state.directoryPhotoRequests].sort((a, b) => a.target - b.target), [{ actor: 9403, target: 9401, status: 404 }, { actor: 9403, target: 9402, status: 503 }], 'Each permitted directory photo is fetched once; malformed IDs never reach HTTP.');
    assert.deepEqual(photoResponses.sort((a, b) => a.path.localeCompare(b.path)), [{ path: '/api/profile/staff/9401/photo', status: 404 }, { path: '/api/profile/staff/9402/photo', status: 503 }]);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'after-directory-avatar-observer.png'), fullPage: true, animations: 'disabled' });
    return { fixtureOnly: true, actualChromiumMutationObserver: true, canonicalOwner: Number(canonical.id), outcomes: photoResponses, photoRequests: fixture.state.directoryPhotoRequests.length, invalidIdRequests: 0, ...stable };
  } catch (error) {
    let timer, uiState;
    try {
      uiState = await Promise.race([page.evaluate(() => ({ path: location.pathname, readyState: document.readyState,
        componentLoaded: Boolean(window.VoxelAvatar), observer: window.__avatarObserverProof ? { ...window.__avatarObserverProof } : null,
        targets: ['avatarObserverMissing','avatarObserverFailed','avatarObserverInvalid'].map(id => { const target = document.getElementById(id); return { id, exists: Boolean(target), state: target?.dataset.avatarState || null, text: target?.textContent || null, busy: target?.getAttribute('aria-busy') || null }; }),
        resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, initiator: entry.initiatorType, responseEnd: entry.responseEnd })) })).catch(() => null),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
    } finally { clearTimeout(timer); }
    fs.writeFileSync(path.join(output, 'directory-avatar-observer-failure.json'), JSON.stringify({ fixtureOnly: true, message: error.message,
      uiState, errors, responses, failedRequests, directoryPhotoRequests: fixture.state.directoryPhotoRequests,
      requests: requests.slice(requestOffset).map(request => ({ path: request.path, method: request.method })) }, null, 2));
    await page.screenshot({ path: path.join(output, 'directory-avatar-observer-failure.png'), fullPage: true, animations: 'disabled', timeout: 5000 }).catch(() => {});
    throw new Error('Real directory avatar MutationObserver scenario failed', { cause: error });
  } finally { await context.close(); }
}

async function verifyInPlaceAccountSwitchCases(browser, fixture) {
  const results = [], privateNote = 'Synthetic account A private handover must never appear for account B';
  for (const scenario of [{ name: 'today', endpoint: '/api/attendance/today' }, { name: 'history', endpoint: '/api/attendance/my' }, { name: 'committed-check-out', endpoint: '/api/attendance/actions', open: true }]) {
    Object.assign(fixture.state, resetState()); fixture.state.photo = true;
    fixture.state.attendance = { id: 9901, user_id: 9401, clock_in: '2026-10-12T23:00:00Z', clock_out: scenario.open ? null : '2026-10-13T00:00:00Z', work_date: '2026-10-13', timestamp_basis: 'UTC', clock_out_timestamp_basis: scenario.open ? null : 'UTC', recorded_timezone: 'Australia/Sydney', entry_source: 'CLOCK', break_minutes: 0, total_minutes: scenario.open ? 0 : 60, total_hours: scenario.open ? 0 : 1, revision: 1, review_required: false, notes: privateNote };
    fixture.state.timeline = [{ id: 'synthetic-a-clock-in', type: 'CHECK_IN', attendance_id: 9901, at: fixture.state.attendance.clock_in, allocated_work_date: '2026-10-13' }];
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' }); context.setDefaultTimeout(15000);
    await context.addCookies([{ name: 'vv_session', value: userSession(9401), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(), errors = [], authOwners = [], responseReads = [];
    let gate, timeout;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (new URL(response.url()).pathname === '/api/auth/me') responseReads.push(response.json().then(body => authOwners.push(Number(body.user?.id)))); });
    try {
      await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' });
      await page.locator('#staffHomePrimaryAction:not([disabled])').waitFor();
      await page.waitForFunction(() => document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Staff Fixture') && document.querySelector('#sidebarAvatar img')?.naturalWidth > 0);
      assert.equal(await page.locator('#staffHomeStatus').getAttribute('data-state'), scenario.open ? 'WORKING' : 'COMPLETED');
      const originalTimeOrigin = await page.evaluate(() => performance.timeOrigin);
      if (scenario.name === 'history') {
        await page.locator('#staffHomeHistory').click();
        await page.locator('.staff-session-card').filter({ hasText: privateNote }).waitFor();
        await page.keyboard.press('Escape');
      }
      // Deliberately emulate a transport that completes after cancellation. The
      // request still uses real HTTP, cookies, auth and CSP; response ownership
      // and epoch checks must protect B even when abort cannot stop A's reply.
      await page.evaluate(endpoint => {
        const realFetch = window.fetch.bind(window); window.__lateAccountReply = { delivered: 0, cancellationIgnored: 0 };
        window.fetch = (input, options = {}) => {
          const pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
          let owner = null; try { owner = Number(JSON.parse(localStorage.getItem('user') || 'null')?.id); } catch {}
          if (pathname === endpoint && owner === 9401) {
            const transport = { ...options }; delete transport.signal; window.__lateAccountReply.cancellationIgnored++;
            return realFetch(input, transport).then(async response => {
              // Complete the body before releasing fetch to the application's
              // continuation; an early stale-owner guard may skip its json().
              await response.clone().json(); window.__lateAccountReply.delivered++; return response;
            });
          }
          return realFetch(input, options);
        };
      }, scenario.endpoint);
      gate = holdNextReply(fixture.state, scenario.endpoint, 9401);
      if (scenario.name === 'today') await page.evaluate(() => { void window.VoxelStaffHome.refresh(); });
      else if (scenario.name === 'history') await page.locator('#staffHomeHistory').click();
      else { await page.locator('#staffHomePrimaryAction').click(); await page.locator('#staffAttendanceConfirm').click(); }
      await Promise.race([gate.entered, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('The real UI did not request the delayed ' + scenario.endpoint)), 12000); })]); clearTimeout(timeout);
      const capturedOwner = Number(gate.payload.profile?.id || gate.payload.state?.profile?.id || gate.payload.attendance?.[0]?.user_id);
      assert.equal(capturedOwner, 9401, 'The withheld response must retain A as its real authenticated owner.');
      if (scenario.open) { assert.equal(fixture.state.receiptRequests.length, 1); assert(fixture.state.attendance.clock_out, 'Check-out was committed for A before its reply was delayed.'); }
      await context.addCookies([{ name: 'vv_session', value: userSession(9402), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
      const cleared = await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('vv:auth-changed'));
        return { stateCleared: window.VoxelStaffHome.state === null, overlayHidden: document.getElementById('staffAttendanceOverlay').hidden, sheetEmpty: document.getElementById('staffAttendanceBody').childElementCount === 0,
          oldPhotoCleared: [...document.querySelectorAll('[data-avatar-self] img')].every(image => image.hidden || !image.getAttribute('src')), privateNameVisible: document.body.innerText.includes('Synthetic Staff Fixture') };
      });
      assert.deepEqual(cleared, { stateCleared: true, overlayHidden: true, sheetEmpty: true, oldPhotoCleared: true, privateNameVisible: false }, 'Account boundary immediately removes A attendance, sheets, identity and photos.');
      await page.waitForFunction(() => document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Other Fixture') && window.VoxelStaffHome.state?.profile?.id === 9402 && document.getElementById('staffHomeStatus')?.getAttribute('data-state') === 'NOT_STARTED');
      gate.release();
      await page.waitForFunction(() => window.__lateAccountReply.delivered >= 1);
      // All response continuations have run before checking that A cannot reopen
      // its checkout note/history or replace B's authoritative attendance.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await page.evaluate(note => ({ owner: window.VoxelStaffHome.state?.profile?.id, sessions: window.VoxelStaffHome.state?.sessions?.length,
        status: document.getElementById('staffHomeStatus')?.getAttribute('data-state'), overlayHidden: document.getElementById('staffAttendanceOverlay').hidden,
        sheetEmpty: document.getElementById('staffAttendanceBody').childElementCount === 0, oldPrivateVisible: document.body.innerText.includes('Synthetic Staff Fixture') || document.body.innerText.includes(note),
        pendingOwner: JSON.parse(sessionStorage.getItem('voxelveda:attendance-pending') || 'null')?.user_id || null, late: window.__lateAccountReply, timeOrigin: performance.timeOrigin }), privateNote);
      assert.equal(after.owner, 9402); assert.equal(after.sessions, 0); assert.equal(after.status, 'NOT_STARTED');
      assert.equal(after.overlayHidden, true); assert.equal(after.sheetEmpty, true); assert.equal(after.oldPrivateVisible, false);
      assert.notEqual(after.pendingOwner, 9401); assert.equal(after.late.cancellationIgnored, 1); assert.equal(after.timeOrigin, originalTimeOrigin, 'This account switch must stay in the same live document.');
      assert.equal(gate.attempted, true); assert.equal(new URL(page.url()).pathname, '/portal/staff');
      await page.locator('#staffHomeHistory').click(); await page.locator('#staffAttendanceBody').getByText('No recorded sessions match these filters.', { exact: true }).waitFor();
      assert.equal(await page.locator('.staff-session-card').count(), 0); assert.equal(await page.locator('#staffAttendanceBody').getByText(privateNote, { exact: false }).count(), 0);
      await page.keyboard.press('Escape'); await Promise.all(responseReads);
      assert(authOwners.includes(9401) && authOwners.includes(9402), 'The same-page switch must verify both owners through the real /auth/me controller.');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, 'after-account-switch-inflight-' + scenario.name + '.png'), fullPage: true, animations: 'disabled' });
      results.push({ scenario: scenario.name, syntheticTransportDelay: true, cancellationDeliberatelyIgnored: true, capturedOwner, verifiedOwners: authOwners, finalOwner: after.owner, finalSessions: after.sessions, lateRepliesDelivered: after.late.delivered, oldPrivateVisible: false, sameDocument: true, committedActionCount: fixture.state.receiptRequests.length });
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'account-switch-' + scenario.name + '-failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
      throw new Error('In-place account boundary scenario failed: ' + scenario.name, { cause: error });
    } finally { clearTimeout(timeout); gate?.release(); await context.close(); }
  }
  return results;
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const baselineDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'voxel-staff-before-'));
  const archive = path.join(baselineDirectory, 'before.tar');
  const savedArchive = '/tmp/voxel-staff-mobile-before-ea5efb9.tar';
  const useSavedArchive = process.env.VV_STAFF_LOCAL_BASELINE_ARCHIVE === 'true'
    && ['a0d0b4298666775d5db35cb63b8eca292897398b', 'ea5efb9fbbd63179bf7a06710e1e7e8affc8e0e4'].includes(baselineRef) && fs.existsSync(savedArchive);
  fs.writeFileSync(archive, useSavedArchive
    ? fs.readFileSync(savedArchive) : execFileSync('git', ['archive', '--format=tar', baselineRef, 'public'], { cwd: project, maxBuffer: 256 * 1024 * 1024 }));
  execFileSync('tar', ['-xf', archive, '-C', baselineDirectory]);
  const canvas = require('@napi-rs/canvas').createCanvas(96, 96), drawing = canvas.getContext('2d');
  drawing.fillStyle = '#165b82'; drawing.fillRect(0, 0, 96, 96);
  const photo = await canvas.encode('png');
  const servers = [], results = [];
  let browser, diagnosticPage, diagnosticDetails = {}, afterFixture;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || process.env.VV_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox'], timeout: 20000 });
    for (const phase of selectedPhase === 'both' ? ['before', 'after'] : [selectedPhase]) {
      const fixture = await makeServer(phase === 'before' ? path.join(baselineDirectory, 'public') : path.join(project, 'public'), photo); servers.push(fixture.server);
      if (phase === 'after') afterFixture = fixture;
      for (const viewport of [{ name: 'phone', width: 375, height: 812 }, { name: 'desktop', width: 1440, height: 1000 }]) {
        Object.assign(fixture.state, resetState());
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
        context.setDefaultTimeout(15000);
        const token = userSession(9401);
        await context.addCookies([{ name: 'vv_session', value: token, url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
        const page = await context.newPage(), errors = [], apiFailures = [], apiResponses = [], expectedInterruptions = [], violations = [];
        diagnosticPage = page; diagnosticDetails = { phase, viewport, errors, apiFailures, apiResponses, expectedInterruptions, requestOffset: requests.length };
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          if (new URL(response.url()).pathname.startsWith('/api/')) apiResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
          if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) {
            const event = { path: new URL(response.url()).pathname, status: response.status() };
            (response.headers()['x-fixture-expected'] === 'COMMIT_REPLY_INTERRUPTED' ? expectedInterruptions : apiFailures).push(event);
          }
        });
        await page.addInitScript(() => { window.__fixtureCspViolations = []; document.addEventListener('securitypolicyviolation', event => { if (event.disposition === 'enforce') window.__fixtureCspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI }); }); });
        const response = await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200); assert(response.headers()['content-security-policy'].includes("default-src 'self'"));
        const canonical = await context.request.get(fixture.origin + '/api/auth/me'); assert.equal(canonical.status(), 200);
        const canonicalIdentity = (await canonical.json()).user; assert.equal(Number(canonicalIdentity.id), 9401); assert.equal(canonicalIdentity.name, 'Synthetic Staff Fixture');
        // The published role portal rewrites .brand p (#sidebarStaffName) to
        // "Staff Portal" after loading. Its actual person-name contract is the
        // separate profile node, which both before and after render from /me.
        await page.waitForFunction(() => document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Staff Fixture'));
        if (phase === 'after') await page.locator('#staffHomePrimaryAction:not([disabled])').waitFor();
        await page.screenshot({ path: path.join(output, `${phase}-staff-home-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
        await page.locator('#staffNotificationBell').click();
        await page.locator('#staffNotificationPanel').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelectorAll('#staffNotificationPanel .notification-item, #staffNotificationPanel [data-notification-id]').length > 0);
        await page.screenshot({ path: path.join(output, `${phase}-notifications-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
        if (phase === 'after') {
          const panel = await page.locator('#staffNotificationPanel').boundingBox();
          assert(panel.x >= -1 && panel.x + panel.width <= viewport.width + 1, 'notification panel must fit the actual viewport');
          assert(panel.y >= -1 && panel.y + panel.height <= viewport.height + 1, 'notification panel must stay within the viewport height');
          assert.equal(await page.locator('#staffNotificationPanel [role="tablist"]').count(), 0, 'the compact notification center removes filter bars');
          assert.equal(await page.locator('#staffNotificationPanel').getByRole('button', { name: /^(Clear all|Clear read|Preferences)$/ }).count(), 0);
          await page.locator('#staffNotificationPanel .vv-notification-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
          await page.waitForFunction(() => document.querySelectorAll('#staffNotificationPanel [data-notification-id]').length === 36);
          assert.equal(new Set(await page.locator('#staffNotificationPanel [data-notification-id]').evaluateAll(nodes => nodes.map(node => node.dataset.notificationId))).size, 36, 'notification pagination does not duplicate entries');
          await page.locator('#staffNotificationPanel [data-notification-id="9801"]').click();
          await page.waitForFunction(() => document.querySelector('#staffNotificationPanel [data-notification-status]')?.textContent.includes('no longer available'));
          assert.equal(new URL(page.url()).pathname, '/portal/staff', 'an unavailable notification target does not navigate to a stale page');
          await page.waitForFunction(() => document.getElementById('staffNotificationBadge')?.textContent === '23');
          await page.locator('#staffNotificationPanel [data-notification-read-all]').click();
          await page.waitForFunction(() => document.getElementById('staffNotificationBadge')?.hidden === true);
          assert(fixture.state.notifications.every(item => item.is_read), 'mark all read persists recipient state');
        }
        await page.keyboard.press('Escape');
        if (phase === 'after') {
          assert.equal(await page.evaluate(() => document.activeElement?.id), 'staffNotificationBell', 'closing notifications restores focus to its actual trigger');
          // This synthetic account has the explicit saved QR bypass permission.
          // The real MySQL suite separately proves signed QR/proof enforcement.
          await page.locator('#staffHomePrimaryAction').click();
          await page.locator('#staffAttendanceConfirm').waitFor();
          assert.equal(fixture.state.receiptRequests.length, 0, 'Opening confirmation must not change attendance');
          fixture.state.loseNextActionReply = true;
          await page.evaluate(() => { const button = document.getElementById('staffAttendanceConfirm'); button.click(); button.click(); });
          await page.locator('#staffAttendanceReconcile').waitFor();
          assert.equal(fixture.state.receiptRequests.length, 1, 'Busy state prevents a second tap from sending another action');
          const originalRequestId = fixture.state.receiptRequests[0].request_id;
          await page.locator('#staffAttendanceReconcile').click();
          await page.locator('#staffAttendanceConfirmedClose').click();
          await page.waitForFunction(() => document.getElementById('staffHomeStatus')?.getAttribute('data-state') === 'WORKING');
          assert.equal(fixture.state.receiptRequests.length, 1, 'Reconciliation recovers a committed request without repeating it');
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.getElementById('staffHomeStatus')?.getAttribute('data-state') === 'WORKING');
          assert.equal(fixture.state.receiptRequests[0].request_id, originalRequestId);
          for (const [status, button] of [['ON_BREAK', '#staffHomeBreakAction'], ['WORKING', '#staffHomeBreakAction'], ['COMPLETED', '#staffHomePrimaryAction']]) {
            await page.locator(button).click(); await page.locator('#staffAttendanceConfirm').click();
            await page.waitForFunction(expected => document.getElementById('staffHomeStatus')?.getAttribute('data-state') === expected, status);
          }
          assert.equal(fixture.state.receiptRequests.length, 4);
          assert(fixture.state.receiptRequests.slice(1).every(item => item.attendance_id === 9901), 'Break and check-out apply to the authoritative exact session');
          await page.locator('#staffCheckoutNotes').fill('Synthetic completed-session handover');
          await page.screenshot({ path: path.join(output, `after-clock-out-notes-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
          await page.locator('#staffCheckoutSave').click();
          await page.locator('#staffAttendanceOverlay').waitFor({ state: 'hidden' });
          assert.equal(fixture.state.attendance.notes, 'Synthetic completed-session handover');
          assert(fixture.state.attendance.clock_out, 'Saving an optional note retains the already confirmed check-out');
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.getElementById('staffHomeStatus')?.getAttribute('data-state') === 'COMPLETED');
          await page.waitForFunction(() => document.getElementById('staffHomeWeekHours')?.textContent === '0.03 hrs');
          assert.equal(fixture.state.receiptRequests.length, 4, 'Refreshing does not repeat any attendance action');
          const beforeMissingRequest = JSON.stringify(fixture.state.attendance);
          await page.locator('#staffHomeHistory').click(); await page.locator('#staffRequestMissingSession').click();
          await page.locator('#staffCorrectionStart').fill('2026-10-12T09:00');
          await page.locator('#staffCorrectionEnd').fill('2026-10-12T10:00');
          await page.locator('#staffCorrectionBreak').fill('0');
          await page.locator('#staffCorrectionReason').fill('Synthetic missing session requires authorised review');
          await page.locator('#staffCorrectionNotes').fill('Synthetic fixture request, with no claimed worked hours');
          await page.screenshot({ path: path.join(output, `after-missing-session-request-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
          await page.locator('#staffCorrectionSubmit').click();
          await page.locator('.staff-correction-item').filter({ hasText: 'Synthetic missing session requires authorised review' }).waitFor();
          assert.equal(fixture.state.correctionRequests.length, 1);
          assert.equal(fixture.state.corrections[0].status, 'PENDING');
          assert.equal(JSON.stringify(fixture.state.attendance), beforeMissingRequest, 'A pending missing-session request cannot create or edit worked attendance');
          assert.equal(await page.locator('[data-staff-correction-review]').count(), 0, 'Own staff cannot approve their correction request');
          await page.keyboard.press('Escape');
        }
        await page.goto(fixture.origin + '/profile', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.getElementById('displayName')?.textContent.includes('Synthetic Staff Fixture'));
        await page.screenshot({ path: path.join(output, `${phase}-profile-initial-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
        fixture.state.photo = true;
        await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Staff Fixture'));
        if (phase === 'after') await page.waitForFunction(() => {
          const image = document.querySelector('#sidebarAvatar img');
          return image && !image.hidden && image.naturalWidth > 0;
        });
        await page.screenshot({ path: path.join(output, `${phase}-profile-photo-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
        const sidebarPhotoRendered = await page.evaluate(() => {
          const image = document.querySelector('#sidebarAvatar img');
          return Boolean(image && !image.hidden && image.naturalWidth > 0 && getComputedStyle(image).display !== 'none');
        });
        if (phase === 'before') assert.equal(sidebarPhotoRendered, ['235cc208e1425f0c9cdedc1e210c7725526a0b01','62ace8be4287ef083c344174739378b8de9a7660','616f8ee9e5d54af1201389ca1b7690a66163d0ad'].includes(baselineRef), 'The current-release baseline preserves its repaired saved avatar; older baselines retain their documented defect.');
        violations.push(...await page.evaluate(() => window.__fixtureCspViolations));
        if (phase === 'after') {
          assert.equal(sidebarPhotoRendered, true, 'after staff photo is loaded before its proof screenshot');
          assert.equal(await page.locator('#sidebarAvatar img').count(), 1, 'staff sidebar must render the authenticated profile photo');
          await context.addCookies([{ name: 'vv_session', value: userSession(9402), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.getElementById('sidebarProfileName')?.textContent.includes('Synthetic Other Fixture'));
          assert(await page.locator('#sidebarAvatar').evaluate(target => [...target.querySelectorAll('img')].every(image => image.hidden || !image.getAttribute('src'))), 'switching the authenticated account must clear or hide the prior account photo');
          assert((await page.locator('#sidebarAvatar').textContent()).trim().length > 0, 'an account without a photo must show initials');
          await page.waitForFunction(() => document.getElementById('staffHomeStatus')?.getAttribute('data-state') === 'NOT_STARTED');
          await page.screenshot({ path: path.join(output, `after-account-switch-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
          assert.deepEqual(errors, [], 'actual after UI must have no JavaScript errors');
          assert.deepEqual(apiFailures, [], 'the after UI must call supported synthetic endpoints successfully');
          assert.deepEqual(violations, [], 'the actual enforced CSP must permit the application UI');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'after staff page must fit narrow and desktop screens');
        }
        results.push({ phase, viewport, fixtureOnly: true, beforeCommit: phase === 'before' ? baselineRef : null, sidebarPhotoRendered, javascriptErrors: errors, apiFailures, expectedInterruptions, attendanceActionCount: fixture.state.receiptRequests.length, enforcedCspViolations: violations });
        await context.close();
      }
    }
    const cameraEmulation = afterFixture ? await verifyEmulatedCameraCases(browser, afterFixture) : [];
    const decoderProviderRetry = afterFixture ? await verifyDecoderProviderRetry(browser, afterFixture) : null;
    const inPlaceAccountSwitch = afterFixture ? await verifyInPlaceAccountSwitchCases(browser, afterFixture) : [];
    const responsiveMatrix = afterFixture ? await verifyResponsiveStaffMatrix(browser, afterFixture) : null;
    const cameraUrlIntent = afterFixture ? await verifyCameraUrlIntent(browser,afterFixture) : null;
    const roleHomes = afterFixture ? await verifyRoleHomes(browser,afterFixture) : null;
    const directoryAvatarObserver = afterFixture ? await verifyDirectoryAvatarObserver(browser, afterFixture) : null;
    const unauthorized = await fetch(`http://127.0.0.1:${servers.at(-1).address().port}/api/profile`);
    assert.equal(unauthorized.status, 401, 'anonymous callers must fail actual API authentication');
    fs.writeFileSync(path.join(output, 'staff-mobile-proof.json'), JSON.stringify({ baselineRef, baselineSource: useSavedArchive ? 'Explicit local preserved byte-equivalent ea5 archive' : 'Pinned remote Git baseline', fixtureOnly: true,
      identity: 'Synthetic staff fixture accounts, example.invalid addresses and synthetic sessions only.', attendanceUiQrPolicy: 'The screenshot action account carries explicit stored QR bypass. QR-required scanner cases include the actual branded gate image in an emulated video stream, the real jsQR decoder, signed-token validation, explicit confirmation and fixture persistence; native hardware is not claimed.', cameraEmulation, decoderProviderRetry, inPlaceAccountSwitch, responsiveMatrix, cameraUrlIntent, roleHomes, directoryAvatarObserver, results }, null, 2));
    console.log('Staff mobile browser before/after screenshots and actual cookie/JWT/CSP fixture passed: ' + output);
  } catch (error) {
    let uiState = null;
    if (diagnosticPage && !diagnosticPage.isClosed()) uiState = await diagnosticPage.evaluate(() => {
      let stored = {}; try { stored = JSON.parse(localStorage.getItem('user') || '{}'); } catch {}
      const text = id => document.getElementById(id)?.textContent?.trim().slice(0, 500) || null;
      return { path: location.pathname, readyState: document.readyState, role: document.body.dataset.vvRole || null,
        brandLabel: text('sidebarStaffName'), profileName: text('sidebarProfileName'), staffInfo: text('staffInfo'), homeStatus: text('staffHomeStatus'), homeError: text('staffHomeErrorText'),
        storedIdentity: { id: stored.id || null, name: stored.name || null, role: stored.role || null }, enforcedCspViolations: window.__fixtureCspViolations || [],
        loadedScripts: [...document.scripts].map(script => script.src ? new URL(script.src).pathname : '[inline]'),
        globals: { loadStaffInfo: typeof window.loadStaffInfo, sharedAvatar: Boolean(window.VoxelAvatar), staffHome: Boolean(window.VoxelStaffHome) } };
    }).catch(() => null);
    if (diagnosticPage && !diagnosticPage.isClosed()) await diagnosticPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
    fs.writeFileSync(path.join(output, 'staff-mobile-failure.json'), JSON.stringify({ baselineRef, fixtureOnly: true, message: error.message, ...diagnosticDetails, uiState, requests: requests.slice(diagnosticDetails.requestOffset || 0).map(request => ({ path: request.path, method: request.method })), completed: results }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    fs.rmSync(baselineDirectory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
