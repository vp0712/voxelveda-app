'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dateOnly = require('../utils/dateOnly');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function reply() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = plain(value); return this; } }; }
function fixture() {
  const state = { shifts: [{ id: 1, user_id: 4, shift_date: '2026-10-20', start_time: '08:00:00', end_time: '16:00:00', role_label: 'Original production', location: 'Workshop', notes: 'Existing original record', status: 'scheduled', deleted: 0 }],
    users: [{ id: 4, active: 1, deleted_at: null, email: 'first@example.test' }, { id: 5, active: 1, deleted_at: null, email: 'second@example.test' }], audits: [], deliveries: [], queues: new Map(), failInsertAt: 0, inserts: 0, failQueueUser: null, queries: [] };
  async function query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim(); state.queries.push({ sql: text, params: [...params] });
    if (/^(CREATE|ALTER)/.test(text)) return [[]];
    if (/SELECT user_id FROM roster_shifts/.test(text)) return [[...state.shifts.filter((row) => row.id === params[0]).map((row) => ({ user_id: row.user_id }))]];
    if (/SELECT id, active, deleted_at FROM users/.test(text)) return [[...state.users.filter((row) => params.includes(row.id)).map(plain)]];
    if (/SELECT \* FROM roster_shifts WHERE id/.test(text)) return [[...state.shifts.filter((row) => row.id === params[0] && (!/deleted = 0/.test(text) || !row.deleted)).map(plain)]];
    if (/SELECT id FROM roster_shifts WHERE user_id/.test(text)) return [[...state.shifts.filter((row) => row.user_id === params[0] && row.shift_date === params[1] && row.start_time.slice(0,5) === String(params[2]).slice(0,5) && row.end_time.slice(0,5) === String(params[3]).slice(0,5) && !row.deleted && row.id !== params[4]).map(plain)]];
    if (/SELECT id, user_id, shift_date/.test(text)) return [[...state.shifts.filter((row) => !row.deleted && params.includes(row.user_id) && row.shift_date >= params.at(-2) && row.shift_date <= params.at(-1)).map(plain)]];
    if (/INSERT INTO roster_shifts/.test(text)) {
      state.inserts += 1;
      if (state.failInsertAt === state.inserts) throw new Error('Injected persistence failure');
      const row = { id: Math.max(0,...state.shifts.map((entry) => entry.id)) + 1, deleted: 0 };
      ['user_id', 'shift_date', 'start_time', 'end_time', 'role_label', 'location', 'notes', 'status', 'break_minutes', 'hourly_rate', 'wage_budget', 'created_by', 'updated_by'].forEach((key,index) => row[key] = params[index]);
      state.shifts.push(row); return [{ insertId: row.id }];
    }
    if (/UPDATE roster_shifts SET deleted =/.test(text)) { state.shifts.find((row) => row.id === params[1]).deleted = /deleted = 1/.test(text) ? 1 : 0; return [{ affectedRows: 1 }]; }
    if (/SELECT r\.\*, u.email AS staff_email/.test(text)) return [[...state.shifts.filter((row) => !row.deleted && ['scheduled','published'].includes(row.status)).map((row) => ({ ...plain(row), staff_email: state.users.find((user) => user.id === row.user_id).email }))]];
    if (/UPDATE roster_shifts SET status = 'published'/.test(text)) { state.shifts.filter((row) => params.slice(1).includes(row.id)).forEach((row) => row.status = 'published'); return [{ affectedRows: params.length - 1 }]; }
    throw new Error('Unexpected fixture query: '+text);
  }
  const db = { query, async getConnection() {
    let snapshot;
    return { query, async beginTransaction() { snapshot = plain({ shifts: state.shifts, audits: state.audits }); },
      async commit() { snapshot = null; }, async rollback() { if (snapshot) { state.shifts = snapshot.shifts; state.audits = snapshot.audits; snapshot = null; } }, release() {} };
  } };
  const module = { exports: {} };
  const dependencies = {
    '../config/db': db, '../services/auditService': { async logAudit(_db, entry) { state.audits.push(plain(entry)); } },
    '../utils/dateOnly': dateOnly, '../config/urls': { absolute: (route) => `https://app.voxelveda.com${route}` },
    'node:crypto': require('node:crypto'), '../services/emailQueue': { async queueEmail(mail) {
      if (mail.to === state.failQueueUser) throw new Error('Injected queue failure');
      state.deliveries.push(plain(mail)); if (!state.queues.has(mail.idempotencyKey)) state.queues.set(mail.idempotencyKey, state.queues.size + 1);
      return state.queues.get(mail.idempotencyKey);
    } }
  };
  new vm.Script(fs.readFileSync(path.join(__dirname,'../controllers/rosterController.js'),'utf8')).runInNewContext({ module, exports: module.exports, Date, console: { error() {} }, require: (name) => { if (!Object.hasOwn(dependencies,name)) throw new Error('Unexpected dependency '+name); return dependencies[name]; } });
  async function call(method, body) { const res = reply(); await module.exports[method]({ body, user: { id: 99 }, get: () => null, query: {} },res); return res; }
  return { state, call };
}
async function run() {
  const { state, call } = fixture();
  const shift = { user_id: 4, shift_date: '2026-10-21', start_time: '08:00', end_time: '16:00', break_minutes: 30, hourly_rate: 25.5, wage_budget: 200 };
  for (const body of [{...shift,shift_date:'2026-02-30'}, {...shift,start_time:'25:00'}, {...shift,user_id:Infinity}, {...shift,break_minutes:-1}, {...shift,break_minutes:480}, {...shift,hourly_rate:Infinity}, {...shift,wage_budget:NaN}, {...shift,status:'invalid'}]) assert.equal((await call('saveShift',body)).statusCode,400);
  assert.equal(state.queries.length,0,'invalid roster fields cannot create or migrate records');
  const oversized = await call('generateRoster',{ user_ids:[4], from_date:'2026-10-01', to_date:'2026-12-01' });
  assert.equal(oversized.statusCode,400); assert.equal(state.shifts.length,1,'oversized range must reject rather than silently truncate');
  const batch = { user_ids:[4,5,6],from_date:'2026-10-20',to_date:'2026-10-20' };
  const generated = await call('generateRoster',batch);
  assert.equal(generated.statusCode,201);
  assert.deepEqual({accepted:generated.body.accepted,duplicates:generated.body.duplicates,rejected:generated.body.rejected,total:generated.body.total},{accepted:1,duplicates:1,rejected:1,total:3});
  assert.deepEqual(generated.body.outcomes.map((item)=>item.status),['duplicate','accepted','rejected']);
  assert.equal(state.shifts[0].notes,'Existing original record','generation must preserve prior shift data');
  const repeated = await call('generateRoster',batch); assert.equal(repeated.statusCode,200); assert.equal(repeated.body.created,0); assert.equal(repeated.body.skipped,2); assert.equal(state.shifts.length,2);
  const beforeFailure = plain(state.shifts);
  state.failInsertAt = state.inserts + 2;
  const failed = await call('generateRoster',{user_ids:[4,5],from_date:'2026-10-22',to_date:'2026-10-22'});
  assert.equal(failed.statusCode,500); assert.deepEqual(state.shifts,beforeFailure,'failed batch must atomically roll back every new shift');
  state.failInsertAt = 0;
  const archived = await call('deleteShift',{id:1}); assert.equal(archived.statusCode,200); assert.equal(state.shifts[0].deleted,1);
  const restored = await call('restoreShift',{id:1}); assert.equal(restored.statusCode,200); assert.equal(state.shifts[0].id,1); assert.equal(state.shifts[0].deleted,0);
  const published = await call('publishRoster',{}); assert.equal(published.statusCode,200); assert.equal(published.body.provider_accepted,false); assert.equal(published.body.recipient_verified,false);
  assert.equal(state.queues.size,2); assert.equal(state.deliveries.length,2);
  for(const mail of state.deliveries){assert(!mail.to.includes(','),'staff notifications need individual recipients');assert(!mail.html.includes('Existing original record'));assert(!mail.html.includes('first@example.test'));assert(!mail.html.includes('second@example.test'));assert(!mail.html.includes('08:00'));assert.equal(mail.attachments,undefined,'normal roster notification must not attach a fallback document');assert.match(mail.html,/View your roster/);}
  await call('publishRoster',{}); assert.equal(state.queues.size,2,'repeat publication must produce the same deterministic notification key');
  state.failQueueUser='second@example.test';
  const queueFailed = await call('publishRoster',{}); assert.equal(queueFailed.statusCode,200); assert.equal(queueFailed.body.email_status,'pending_retry'); assert(queueFailed.body.notification_outcomes.some((item)=>item.status==='QUEUE_FAILED'&&item.retryable));
  assert(!queueFailed.body.message.includes('email sent'),'queue failure must not claim delivery');
  console.log('Roster tests passed: real calendar/time/staff/amount validation, oversized range rejection, accepted/rejected/duplicate outcomes, repeated-batch idempotence, atomic failure rollback, archive/restore preserving IDs, individual privacy-safe notification queues, deterministic keys and delivery-state separation.');
}
run().catch((error)=>{console.error(error);process.exitCode=1;});
