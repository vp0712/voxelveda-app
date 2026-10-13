'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeTimesheetDeliveryEmail } = require('../services/timesheetDeliveryPreferenceService');
const catalog = require('../config/permissionCatalog');
const authorization = require('../services/authorizationService');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const plain = value => JSON.parse(JSON.stringify(value));
const noop = async () => {};
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = plain(body); return this; } }; }
function load(file, dependencies) {
  const fixture = { exports: {} }, filename = path.join(__dirname, '..', file);
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module: fixture, exports: fixture.exports, __filename: filename, __dirname: path.dirname(filename), process: { env: {} }, Buffer, Date,
    console: { error() {} }, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; if (name === 'crypto') return require(name); throw new Error('Unexpected preference fixture dependency: ' + name); } });
  return fixture.exports;
}
function database() {
  const state = { users: [
    { id: 1, name: 'Staff A', username: 'staff-a', email: 'login-a@example.invalid', role: 'staff', permissions: '[]', active: 1, account_status: 'ACTIVE', timesheet_delivery_email: 'designated-a@example.invalid', department: null, manager_id: null, access_scope: null },
    { id: 2, name: 'Staff B', username: 'staff-b', email: 'login-b@example.invalid', role: 'staff', permissions: '[]', active: 1, account_status: 'ACTIVE', timesheet_delivery_email: null, department: null, manager_id: null, access_scope: null }
  ], profiles: [{ user_id: 1, mobile_number: '+61 400 000 001' }], audits: [], queries: [], commits: 0, rollbacks: 0, auditFailure: false };
  let tail = Promise.resolve();
  async function query(sql, params = [], transaction = false) {
    const text = sql.replace(/\s+/g, ' ').trim(); state.queries.push({ text, params: [...params], transaction });
    if (text.startsWith('SELECT mobile_number FROM user_profiles')) return [[...state.profiles.filter(row => row.user_id === params[0]).map(plain)]];
    if (text.includes('FROM users u LEFT JOIN user_profiles')) {
      const row = state.users.find(item => item.id === params[0]); return [[...(row ? [{ ...row, ...state.profiles.find(item => item.user_id === row.id) }] : [])]];
    }
    if (text.startsWith('SELECT role FROM users')) return [[...state.users.filter(row => row.id === params[0]).map(row => ({ role: row.role }))]];
    if (text.startsWith('SELECT id FROM users WHERE LOWER(email)')) return [[...state.users.filter(row => row.email.toLowerCase() === params[0] || row.username.toLowerCase() === params[1]).map(row => ({ id: row.id }))]];
    if (text.startsWith('SELECT id FROM users WHERE (LOWER(email)')) return [[...state.users.filter(row => row.id !== params[2] && (row.email.toLowerCase() === params[0] || row.username.toLowerCase() === params[1])).map(row => ({ id: row.id }))]];
    if (text.startsWith('SELECT name,') && text.includes('FROM users')) { assert(transaction && /FOR UPDATE$/.test(text), 'staff preferences must lock the account before delivery races'); return [[...state.users.filter(row => row.id === params[0]).map(plain)]]; }
    if (text.startsWith('INSERT INTO users')) {
      assert(transaction); const row = { id: state.users.length + 1, active: 0, account_status: 'INVITED' };
      ['name','username','email','password','role','permissions','department','manager_id','access_scope','timesheet_delivery_email'].forEach((key, index) => row[key] = params[index]);
      state.users.push(row); return [{ insertId: row.id }];
    }
    if (text.startsWith("UPDATE users SET account_status = 'INVITED'")) { assert(transaction); return [{ affectedRows: 1 }]; }
    if (text.startsWith('UPDATE users SET name = ?, timesheet_delivery_email')) { assert(transaction); const row = state.users.find(item => item.id === params[2]); [row.name, row.timesheet_delivery_email] = params; return [{ affectedRows: 1 }]; }
    if (text.startsWith('UPDATE users SET name = ?, username')) {
      assert(transaction); const row = state.users.find(item => item.id === params[10]);
      ['name','username','email','role','permissions','active','department','manager_id','access_scope','timesheet_delivery_email'].forEach((key, index) => row[key] = params[index]); return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO user_profiles')) {
      assert(transaction); let row = state.profiles.find(item => item.user_id === params[0]); if (!row) { row = { user_id: params[0] }; state.profiles.push(row); } row.mobile_number = params[1]; return [{ affectedRows: 1 }];
    }
    if (text.startsWith('UPDATE auth_sessions') || text.startsWith('UPDATE users SET session_version')) { assert(transaction); return [{ affectedRows: 1 }]; }
    if (text.includes('FROM users') && text.includes('ORDER BY id ASC')) return [[...state.users.map(plain)]];
    throw new Error('Unexpected preference fixture SQL: ' + text);
  }
  const db = { query: (sql, params) => query(sql, params), async getConnection() {
    let snapshot, releaseLock, transaction = false;
    return { query: (sql, params) => query(sql, params, transaction), async beginTransaction() { const previous = tail; tail = new Promise(resolve => { releaseLock = resolve; }); await previous; snapshot = plain({ users: state.users, profiles: state.profiles, audits: state.audits }); transaction = true; },
      async commit() { state.commits += 1; transaction = false; releaseLock(); }, async rollback() { if (transaction) { Object.assign(state, snapshot); state.rollbacks += 1; transaction = false; releaseLock(); } }, release() { assert(!transaction, 'release must close any unsuccessful transaction'); } };
  } };
  const dependencies = {
    '../config/db': db, bcryptjs: { hash: async () => 'fixture-only-disabled-password' },
    '../services/auditService': { async logAudit(connection, entry) { assert.notEqual(connection, db, 'audit must share the record transaction'); if (state.auditFailure) throw new Error('Audit unavailable'); state.audits.push(plain(entry)); } },
    '../services/hrAdministrationSchema': { ensureHrAdministrationSchema: noop }, '../services/securityGovernanceSchema': { ensureSecurityGovernanceSchema: noop },
    '../services/profilePhotoService': { ensureProfilePhotoSchema: noop }, '../services/customerRecordScope': require('../services/customerRecordScope'),
    '../services/timesheetDeliveryPreferenceService': { normalizeTimesheetDeliveryEmail }, '../services/userLifecycleService': { ensureUserLifecycleSchema: noop },
    '../services/coreAuditSchema': { ensureCoreAuditSchema: noop }, '../services/securitySchema': { ensureSecuritySchema: noop },
    '../services/sessionService': { revokeUserSessions: noop, logSecurityEvent: noop }, '../services/authActionTokenService': { issueToken: async () => 'fixture-token', revokeUserActionTokens: noop },
    '../services/securityEmailService': { queueSecurityLink: noop }, '../config/permissionCatalog': catalog, '../services/authorizationService': authorization,
    '../services/segregationPolicyService': { assertNoSegregationConflicts: noop }, '../services/userSecurityService': { ACCOUNT_STATES: [], permissionDifference: () => ({}), revokeEveryCredential: noop, transitionAccount: noop }
  };
  return { state, dependencies };
}
async function call(handler, body, options = {}) {
  const res = response(); await handler({ user: options.user === undefined ? { id: 1, role: 'staff' } : options.user, body, params: { id: options.id || 1 }, ip: '127.0.0.1', get: () => 'preference-fixture' }, res); return res;
}
async function schemaSafety() {
  const sql = [];
  const service = load('services/hrAdministrationSchema.js', { '../config/db': { async query(text) { sql.push(text); return [[...['employee_number','department','manager_id','access_scope'].map(COLUMN_NAME => ({ COLUMN_NAME }))]]; } } });
  await Promise.all([service.ensureHrAdministrationSchema(), service.ensureHrAdministrationSchema()]);
  assert.equal(sql.length, 2); assert.match(sql[1], /^ALTER TABLE users ADD COLUMN timesheet_delivery_email VARCHAR\(254\) NULL$/);
  assert(!sql.some(text => /UPDATE|DELETE|DROP|TRUNCATE/.test(text)), 'adding an explicit preference must not infer recipients or rewrite existing records');
}
async function preferenceSafety() {
  for (const value of [null, '', '   ', undefined]) assert.equal(normalizeTimesheetDeliveryEmail(value), null);
  assert.equal(normalizeTimesheetDeliveryEmail(' Staff.A+weekly@EXAMPLE.com '), 'Staff.A+weekly@example.com');
  for (const value of ['a@example.com,b@example.com','a@example.com; b@example.com','Staff A <a@example.com>','a@example.com\r\nBcc:b@example.com','a..b@example.com','a@localhost','a@-example.com', ['a@example.com'], 123, 'a'.repeat(65) + '@example.com']) {
    assert.throws(() => normalizeTimesheetDeliveryEmail(value), error => error.statusCode === 400 && Boolean(error.fields.timesheet_delivery_email));
  }
  const { state, dependencies } = database(), profile = load('controllers/profileController.js', dependencies);
  let result = await call(profile.getMyProfile, {}); assert.equal(result.body.profile.timesheet_delivery_email, 'designated-a@example.invalid'); assert.equal(result.body.profile.email, 'login-a@example.invalid');
  assert.equal((await call(profile.updateMyProfile, { name: 'Staff A' }, { user: null })).statusCode, 401);
  const beforeInvalid = plain(state.users); result = await call(profile.updateMyProfile, { name: 'Bad change', timesheet_delivery_email: 'a@example.com,b@example.com' });
  assert.equal(result.statusCode, 400); assert(result.body.fields.timesheet_delivery_email); assert.deepEqual(state.users, beforeInvalid);
  result = await call(profile.updateMyProfile, { name: 'Staff A updated', mobile_number: '+61 400 000 001' });
  assert.equal(result.statusCode, 200); assert.equal(state.users[0].timesheet_delivery_email, 'designated-a@example.invalid', 'older clients omitting the field must preserve explicit designation');
  result = await call(profile.updateMyProfile, { name: 'Staff A updated', mobile_number: '+61 400 000 001', timesheet_delivery_email: 'private-a@example.invalid', user_id: 2 });
  assert.equal(result.statusCode, 200); assert.equal(state.users[0].timesheet_delivery_email, 'private-a@example.invalid'); assert.equal(state.users[1].timesheet_delivery_email, null, 'own profile never changes an unrelated staff member');
  const audit = state.audits.at(-1); assert.equal(audit.actorId, 1); assert.equal(audit.recordId, 1); assert.equal(audit.oldValue.timesheet_delivery_email, 'designated-a@example.invalid'); assert.equal(audit.newValue.timesheet_delivery_email, 'private-a@example.invalid');
  const auditCount = state.audits.length; result = await call(profile.updateMyProfile, { name: 'Staff A updated', mobile_number: '+61 400 000 001', timesheet_delivery_email: 'private-a@example.invalid' }); assert.equal(result.body.unchanged, true); assert.equal(state.audits.length, auditCount, 'duplicate submission is a safe no-op');
  state.auditFailure = true; const beforeFailure = plain({ users: state.users, profiles: state.profiles });
  result = await call(profile.updateMyProfile, { name: 'Must roll back', mobile_number: '+61 400 000 099', timesheet_delivery_email: 'bad-save@example.invalid' }); assert.equal(result.statusCode, 500); assert.deepEqual({ users: state.users, profiles: state.profiles }, beforeFailure); state.auditFailure = false;
  result = await call(profile.updateMyProfile, { name: 'Staff A updated', mobile_number: '+61 400 000 001', timesheet_delivery_email: '' }); assert.equal(result.statusCode, 200); assert.equal(state.users[0].timesheet_delivery_email, null);
  result = await call(profile.getMyProfile, {}); assert.equal(result.body.profile.timesheet_delivery_email, null, 'login email is never substituted after clearing');
  const controller = load('controllers/userController.js', dependencies), admin = { id: 99, role: 'admin' };
  const edit = { name: 'Staff B edited', username: 'staff-b', email: 'login-b@example.invalid', timesheet_delivery_email: 'designated-b@example.invalid' };
  result = await call(controller.updateUser, edit, { id: 2, user: admin }); assert.equal(result.statusCode, 200); assert.equal(state.users[1].timesheet_delivery_email, 'designated-b@example.invalid'); assert.equal(state.audits.at(-1).actorId, 99);
  const { timesheet_delivery_email, ...oldEdit } = edit; result = await call(controller.updateUser, oldEdit, { id: 2, user: admin }); assert.equal(result.statusCode, 200); assert.equal(state.users[1].timesheet_delivery_email, timesheet_delivery_email);
  state.auditFailure = true; const beforeAdminFailure = plain(state.users); result = await call(controller.updateUser, { ...edit, timesheet_delivery_email: 'other@example.invalid' }, { id: 2, user: admin }); assert.equal(result.statusCode, 500); assert.deepEqual(state.users, beforeAdminFailure); state.auditFailure = false;
  result = await call(controller.createUser, { name: 'Staff C', email: 'login-c@example.invalid' }, { user: admin }); assert.equal(result.statusCode, 200); assert.equal(state.users[2].timesheet_delivery_email, null, 'new staff receive no designation unless explicitly supplied');
  result = await call(controller.getUsers, {}, { user: admin }); assert.equal(result.body.users[1].timesheet_delivery_email, 'designated-b@example.invalid');
  const denial = response(); let next = false; requireAnyPermission('MANAGE_USERS')({ user: { id: 1, role: 'staff', permissions: ['VIEW_ATTENDANCE'] } }, denial, () => { next = true; }); assert.equal(denial.statusCode, 403); assert.equal(next, false);
  const forbidden = response(); bodyContract(['name','mobile_number','timesheet_delivery_email'], { required: ['name'] })({ body: { name: 'Staff A', user_id: 2 } }, forbidden, () => { throw new Error('mass assignment permitted'); }); assert.equal(forbidden.statusCode, 400);
  assert(state.rollbacks >= 2); assert(!state.queries.some(query => /^(DELETE|DROP|TRUNCATE)/.test(query.text)));
}
(async () => { await schemaSafety(); await preferenceSafety(); console.log('Timesheet delivery preference tests passed: explicit single mailbox, no fallback, isolated edits, atomic audit rollback, preserved omitted values and guarded staff access.'); })().catch(error => { console.error(error); process.exitCode = 1; });
