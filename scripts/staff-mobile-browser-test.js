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
const baselineRef = process.env.VV_STAFF_BASELINE_REF || 'a0d0b4298666775d5db35cb63b8eca292897398b';
assert(/^[a-f0-9]{40}$/.test(baselineRef), 'Before screenshots require an exact preserved Git commit.');
const selectedPhase = process.env.VV_STAFF_PROOF_PHASE || 'both';
assert(['before', 'after', 'both'].includes(selectedPhase), 'Choose before, after or both for staff proof.');
const output = process.env.UI_PROOF_DIR || path.join(os.tmpdir(), 'voxelveda-staff-mobile-proof');
const identities = new Map([
  [9401, { id: 9401, name: 'Synthetic Staff Fixture', username: 'synthetic.staff', email: 'synthetic-staff@example.invalid', role: 'staff', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET', 'attendance_qr_bypass'] }],
  [9402, { id: 9402, name: 'Synthetic Other Fixture', username: 'synthetic.other', email: 'synthetic-other@example.invalid', role: 'staff', active: 1, account_status: 'ACTIVE', session_version: 1, mfa_enabled: 0, permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET'] }]
]);
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
    serverNow: new Date('2026-10-13T00:00:00Z'), loseNextActionReply: false, corrections: [], correctionRequests: [], qrValidationRequests: []
  };
}
function attendanceState(state, userId = 9401) {
  const row = state.attendance?.user_id === userId ? state.attendance : null;
  const open = row && !row.clock_out, onBreak = open && Boolean(state.breakStart);
  const ongoingBreak = onBreak ? Math.floor((state.serverNow - state.breakStart) / 60000) : 0;
  const live = open ? Math.floor((state.serverNow - new Date(row.clock_in)) / 60000) - row.break_minutes - ongoingBreak : 0;
  const active = open ? { ...row, live_worked_minutes: live, live_break_minutes: ongoingBreak, recorded_break_minutes: row.break_minutes, overnight: false, allocated_work_date: row.work_date } : null;
  return { attendance: active || row, sessions: row ? [{ ...row }] : [], status: open ? onBreak ? 'ON_BREAK' : 'WORKING' : row ? 'COMPLETED' : 'NOT_STARTED',
    active_attendance: active, completed_attendance_id: row?.clock_out ? row.id : null,
    company_timezone: 'Australia/Sydney', work_date: '2026-10-13', server_time: state.serverNow.toISOString(),
    summary: { worked_minutes: row?.clock_out ? row.total_minutes : 0, live_worked_minutes: live, recorded_break_minutes: row?.break_minutes || 0, live_break_minutes: ongoingBreak, session_count: row ? 1 : 0, eligible_session_count: row?.clock_out ? 1 : 0, duplicate_session_count: 0, review_required: false },
    timeline: row ? state.timeline : [], next_roster: null, tasks: [], categories: [], qr_required: userId !== 9401,
    allowed_actions: open ? ['CHECK_OUT', onBreak ? 'BREAK_END' : 'BREAK_START'] : ['CHECK_IN'],
    break_policy: { mode: 'RECORDED_ACTUAL', automatic_deduction: false }, reporting_basis: 'WHOLE_SHIFT_LOCAL_START_DATE', review_issues: [] };
}
async function makeServer(publicDirectory, photo) {
  const state = resetState(), app = express();
  app.disable('x-powered-by'); app.use(security.securityHeaders); app.use(express.json()); app.use(security.csrfProtection);
  app.use((req, _res, next) => { requests.push({ path: req.path, method: req.method }); next(); });
  app.get('/login', (_req, res) => res.type('html').send('<!doctype html><title>Synthetic fixture sign in</title><h1>Sign in</h1>'));
  for (const [route, file] of [['/portal/staff', 'staff-dashboard.html'], ['/profile', 'profile.html'], ['/admin', 'admin-dashboard.html']]) {
    app.get(route, pageAuth(), (_req, res) => res.set('Cache-Control', 'private, no-store').type('html').send(brand.injectGlobalBrand(fs.readFileSync(path.join(publicDirectory, file), 'utf8'))));
  }
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
  app.get('/api/attendance/today', (req, res) => res.json(attendanceState(state, Number(req.user.id))));
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
  app.post('/api/attendance/actions', (req, res) => {
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
    return res.json({ ...response, state: attendanceState(state, userId) });
  });
  app.post('/api/attendance/sessions/:id/note', (req, res) => {
    const row = state.attendance;
    if (!row || row.user_id !== Number(req.user.id) || row.id !== Number(req.params.id) || !row.clock_out) return res.sendStatus(404);
    if (Number(req.body.expected_revision) !== row.revision) return res.status(409).json({ code: 'ATTENDANCE_REVISION_CONFLICT' });
    row.notes = req.body.notes; row.revision++; mutations.push({ type: 'checkout_note', attendance_id: row.id });
    res.json({ attendance_id: row.id, attendance: { ...row }, state: attendanceState(state, Number(req.user.id)) });
  });
  app.get('/api/attendance/week', (_req, res) => res.json({ attendance: [], timesheet: null, total_hours: 0 }));
  app.get('/api/attendance/my', (req, res) => {
    const rows = state.attendance?.user_id === Number(req.user.id) ? [{ ...state.attendance }] : [];
    res.json({ attendance: rows, timesheets: [], page: 1, page_size: 20, total: rows.length, pages: 1 });
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
    { name: 'allowed-valid-signed-token', mode: 'token', token: () => qr.createSiteToken(new Date()).token, calls: 1, tracks: 1, valid: true },
    { name: 'invalid-signed-token', mode: 'token', token: () => 'synthetic-invalid-signed-token', calls: 1, tracks: 1, code: 'ATTENDANCE_QR_INVALID' },
    { name: 'expired-signed-token', mode: 'token', token: () => qr.createSiteToken(new Date(Date.now() - 120000)).token, calls: 1, tracks: 1, code: 'ATTENDANCE_QR_EXPIRED' },
    { name: 'wrong-site-signed-token', mode: 'token', token: () => {
      const previous = process.env.SHIFT_QR_SITE_ID;
      try { process.env.SHIFT_QR_SITE_ID = 'synthetic-different-attendance-site'; return qr.createSiteToken(new Date()).token; }
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
        const page = await context.newPage(), errors = [], apiFailures = [], expectedInterruptions = [], violations = [];
        diagnosticPage = page; diagnosticDetails = { phase, viewport, errors, apiFailures, expectedInterruptions };
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) {
            const event = { path: new URL(response.url()).pathname, status: response.status() };
            (response.headers()['x-fixture-expected'] === 'COMMIT_REPLY_INTERRUPTED' ? expectedInterruptions : apiFailures).push(event);
          }
        });
        await page.addInitScript(() => { window.__fixtureCspViolations = []; document.addEventListener('securitypolicyviolation', event => { if (event.disposition === 'enforce') window.__fixtureCspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI }); }); });
        const response = await page.goto(fixture.origin + '/portal/staff', { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200); assert(response.headers()['content-security-policy'].includes("default-src 'self'"));
        await page.waitForFunction(() => document.getElementById('sidebarStaffName')?.textContent.includes('Synthetic Staff Fixture'));
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
        await page.waitForFunction(() => document.getElementById('sidebarStaffName')?.textContent.includes('Synthetic Staff Fixture'));
        if (phase === 'after') await page.waitForFunction(() => {
          const image = document.querySelector('#sidebarAvatar img');
          return image && !image.hidden && image.naturalWidth > 0;
        });
        await page.screenshot({ path: path.join(output, `${phase}-profile-photo-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
        const sidebarPhotoRendered = await page.evaluate(() => {
          const image = document.querySelector('#sidebarAvatar img');
          return Boolean(image && !image.hidden && image.naturalWidth > 0 && getComputedStyle(image).display !== 'none');
        });
        if (phase === 'before') assert.equal(sidebarPhotoRendered, false, 'the pinned baseline captures the unloaded staff avatar defect');
        violations.push(...await page.evaluate(() => window.__fixtureCspViolations));
        if (phase === 'after') {
          assert.equal(sidebarPhotoRendered, true, 'after staff photo is loaded before its proof screenshot');
          assert.equal(await page.locator('#sidebarAvatar img').count(), 1, 'staff sidebar must render the authenticated profile photo');
          await context.addCookies([{ name: 'vv_session', value: userSession(9402), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }]);
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForFunction(() => document.getElementById('sidebarStaffName')?.textContent.includes('Synthetic Other Fixture'));
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
    const unauthorized = await fetch(`http://127.0.0.1:${servers.at(-1).address().port}/api/profile`);
    assert.equal(unauthorized.status, 401, 'anonymous callers must fail actual API authentication');
    fs.writeFileSync(path.join(output, 'staff-mobile-proof.json'), JSON.stringify({ baselineRef, baselineSource: useSavedArchive ? 'Explicit local preserved byte-equivalent ea5 archive' : 'Pinned remote Git baseline', fixtureOnly: true,
      identity: 'Synthetic staff fixture accounts, example.invalid addresses and synthetic sessions only.', attendanceUiQrPolicy: 'The screenshot action account carries explicit stored QR bypass. Separate QR-required scanner cases emulate camera access and decoded-token input, with real signed-token validation; native hardware is not claimed.', cameraEmulation, results }, null, 2));
    console.log('Staff mobile browser before/after screenshots and actual cookie/JWT/CSP fixture passed: ' + output);
  } catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) await diagnosticPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
    fs.writeFileSync(path.join(output, 'staff-mobile-failure.json'), JSON.stringify({ baselineRef, fixtureOnly: true, message: error.message, ...diagnosticDetails, completed: results }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    fs.rmSync(baselineDirectory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
