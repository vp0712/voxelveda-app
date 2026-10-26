'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const money = require('../utils/money');
const dates = require('../utils/dateOnly');
const paymentDomain = require('../services/expensePaymentDomain');
const crypto = require('node:crypto');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = plain(body); return this; } }; }
function load(file, dependencies) {
  const fixture = { exports: {} }, filename = path.join(__dirname, '..', file);
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInNewContext({ module: fixture, exports: fixture.exports, __filename: filename, __dirname: path.dirname(filename), process: { env: {} }, Date, Buffer, URL,
    console: { error() {} }, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; if (['fs', 'path', 'crypto'].includes(name)) return require(name); throw new Error('Unexpected test dependency: ' + name); } });
  return fixture.exports;
}
function fixture(type) {
  const state = { records: type === 'tasks' ? [{ id: 1, assigned_to: 4, status: 'pending', deleted: 0 }] : [], payments: [], receipts: [], audits: [], queries: [], auditFailure: false, refreshFailure: false, commits: 0, rollbacks: 0 };
  async function query(sql, params = [], transaction = false) {
    const text = sql.replace(/\s+/g, ' ').trim(); state.queries.push({ sql: text, params: [...params], transaction });
    if (/^(CREATE|ALTER)/.test(text)) return [[]];
    if(/SELECT DATE_FORMAT\(UTC_TIMESTAMP/.test(text))return [[{server_utc:new Date().toISOString().slice(0,19).replace('T',' ')}]];
    if (/SELECT permissions FROM users/.test(text)) return [[{ permissions: '["attendance_qr_bypass"]' }]];
    if (/SELECT id,active,deleted_at FROM users/.test(text)) return [[{id:params[0],active:1,deleted_at:null}]];
    if (/SELECT id,name,role,active,deleted_at,account_status,employee_number FROM users/.test(text))return [[{id:params[0],name:'Fixture staff',role:'staff',active:1,account_status:'ACTIVE',deleted_at:null}]];
    if (/SELECT id FROM users/.test(text)) return [[{ id: params[0] }]];
    if (type === 'attendance') {
      if(/SELECT \* FROM attendance_action_receipts/.test(text))return [[...state.receipts.filter(row=>row.user_id===params[0]&&row.request_id===params[1]).map(plain)]];
      if(/INSERT INTO attendance_action_receipts/.test(text)){assert(transaction);const row={id:state.receipts.length+1};['user_id','request_id','action','attendance_id','payload_sha256','response_json'].forEach((key,i)=>row[key]=params[i]);state.receipts.push(row);return[{insertId:row.id}];}
      if(/FROM attendance_break_intervals/.test(text))return [[]];
      if(/SELECT id FROM staff_attendance.*clock_in</.test(text))return [[...state.records.filter(row=>row.user_id===params[0]&&!row.deleted&&row.id!==params[1]&&row.clock_in<params[2]&&(!row.clock_out||row.clock_out>params[3])).map(plain)]];
      if (/SELECT id,user_id FROM staff_attendance/.test(text)) return [[...state.records.filter(row=>!row.clock_out&&!row.deleted&&!row.review_required).map(plain)]];
      if (/SELECT id, status, total_hours/.test(text)) { if (state.refreshFailure) throw new Error('Refresh unavailable'); return [[{ id: 1, status: 'DRAFT' }]]; }
      if (/UPDATE weekly_timesheets/.test(text)) return [{ affectedRows: 1 }];
      if (/SELECT/.test(text) && /FROM staff_attendance/.test(text)) {
        let rows = state.records;
        if (/WHERE (?:a\.)?id\s*=/.test(text)) rows = rows.filter((row) => row.id === params[0] && (!/a\.user_id=/.test(text)||row.user_id===params[1]));
        else if (/WHERE.*user_id\s*=/.test(text)) rows = rows.filter((row) => row.user_id === params[0]);
        if (/deleted, ?0\) ?= ?0/.test(text)) rows = rows.filter((row) => !row.deleted);
        if (/clock_out IS NULL/.test(text)) rows = rows.filter((row) => !row.clock_out);
        if (/clock_out <=>/.test(text)) rows=rows.filter(row=>row.clock_in===params[1]&&row.clock_out===params[2]&&row.total_minutes===params[3]&&row.notes===params[4]);
        if (/id <>/.test(text)) rows = rows.filter((row) => row.id !== params[1]);
        if (/IFNULL\(a.deleted, 0\) = \?/.test(text)) rows = rows.filter((row) => row.deleted === params[0]);
        return [[...rows.map(plain)]];
      }
      if (/INSERT INTO staff_attendance/.test(text)) {
        assert(transaction); const row = { id: state.records.length + 1, deleted: 0, revision:1 };
        if (/VALUES \(\?, UTC_TIMESTAMP\(\)/.test(text)) Object.assign(row, { user_id: params[0], clock_in: '2026-10-11 08:00:00', clock_out: null, work_date: params[1], total_minutes: 0, total_hours: 0,timestamp_basis:'UTC',recorded_timezone:params[2],entry_source:'CLOCK' });
        else if(/entry_source,timestamp_basis,recorded_timezone,attendance_status,revision/.test(text))Object.assign(row,{user_id:params[0],clock_in:params[1],work_date:params[2],total_minutes:0,total_hours:0,entry_source:'CLOCK',timestamp_basis:'UTC',recorded_timezone:params[3],attendance_status:'INCOMPLETE',clock_out:null,clock_in_utc_text:params[1]});
        else text.match(/staff_attendance \(([^)]+)/)[1].split(',').map(key=>key.trim()).forEach((key, i) => row[key] = params[i]);
        state.records.push(row); return [{ insertId: row.id }];
      }
      if (/UPDATE staff_attendance SET clock_out=\?/.test(text)){assert(transaction);const row=state.records.find(row=>row.id===params.at(-1));Object.assign(row,{clock_out:params[0],clock_out_utc_text:params[0],clock_out_timestamp_basis:'UTC',total_minutes:params[1],total_hours:params[2],break_minutes:params[3],checkout_task_id:params[4],checkout_category:params[5],notes:params[6]??row.notes,attendance_status:params[7],review_required:params[8],review_reason:params[9],revision:Number(row.revision||1)+1});return[{affectedRows:1}];}
      if (/UPDATE staff_attendance SET clock_out=UTC_TIMESTAMP/.test(text)) {assert(transaction);const row=state.records.find(row=>row.id===params[0]);Object.assign(row,{clock_out:'2026-10-12 01:00:00',clock_out_timestamp_basis:'UTC',review_required:1,review_reason:'ATTENDANCE_TIMEZONE_UNVERIFIED',attendance_status:'REVIEW_REQUIRED'});return[{affectedRows:1}];}
      if (/UPDATE staff_attendance SET review_required/.test(text)){state.records.filter(row=>params[0].includes(row.id)&&!row.clock_out).forEach(row=>Object.assign(row,{review_required:1,review_reason:'INCOMPLETE_SHIFT_REQUIRES_REVIEW'}));return[{affectedRows:1}];}
      if (/UPDATE staff_attendance SET user_id=/.test(text)) { assert(transaction); const row=state.records.find(entry=>entry.id===params.at(-1));let cursor=0;text.match(/SET (.+) WHERE/)[1].split(',').forEach(part=>{const [key,value]=part.split('=').map(v=>v.trim());if(value==='?')row[key]=params[cursor++];else if(value==='NULL')row[key]=null;else if(value==='revision+1')row[key]=Number(row[key]||1)+1;});return[{affectedRows:1}];}
      if (/UPDATE staff_attendance SET deleted/.test(text)) { assert(transaction); state.records.find((row) => row.id === params[1]).deleted = params[0]; return [{ affectedRows: 1 }]; }
    }
    if (type === 'expenses') {
      if (/SELECT expense_id FROM expense_payments/.test(text)) return [[...state.payments.filter((row) => row.id === params[0]).map((row) => ({ expense_id: row.expense_id }))]];
      if (/SELECT \* FROM expense_payments/.test(text)) return [[...state.payments.filter((row) => /idempotency_key =/.test(text) ? row.idempotency_key === params[0] : row.id === params[0]).map(plain)]];
      if (/SUM\(amount\)/.test(text)) { const rows = state.payments.filter((row) => row.expense_id === params[0] && !row.voided_at); return [[{ payment_count: rows.length, payment_total: money.add(...rows.map((row) => row.amount)) }]]; }
      if (/SELECT \* FROM expenses/.test(text)) return [[...state.records.filter((row) => /request_key =/.test(text) ? row.request_key === params[0] : row.id === params[0]).filter((row) => !/deleted = 0/.test(text) || !row.deleted).map(plain)]];
      if (/INSERT INTO expenses/.test(text)) {
        assert(transaction); const row = { id: state.records.length + 1, deleted: 0 };
        ['expense_date','due_date','supplier_name','category','description','invoice_no','payment_method','amount_ex_gst','gst_rate','gst_amount','total_amount','status','notes','created_by','request_key','request_hash'].forEach((key, i) => row[key] = params[i]);
        state.records.push(row); return [{ insertId: row.id }];
      }
      if (/UPDATE expenses SET expense_date/.test(text)) {
        assert(transaction); const row = state.records.find((entry) => entry.id === params[14]);
        ['expense_date','due_date','supplier_name','category','description','invoice_no','payment_method','amount_ex_gst','gst_rate','gst_amount','total_amount','status','notes','updated_by'].forEach((key, i) => row[key] = params[i]); return [{ affectedRows: 1 }];
      }
      if (/UPDATE expenses SET status/.test(text)) { assert(transaction); state.records.find((row) => row.id === params.at(-1)).status = params[0]; return [{ affectedRows: 1 }]; }
      if (/UPDATE expenses SET deleted/.test(text)) { assert(transaction); const row = state.records.find((entry) => entry.id === params[2]); row.deleted = params[0]; row.updated_by = params[1]; return [{ affectedRows: 1 }]; }
      if (/INSERT INTO expense_payments/.test(text)) {
        assert(transaction); const row = { id: state.payments.length + 1, voided_at: null };
        ['expense_id','amount','payment_date','payment_method','account_name','reference','notes','idempotency_key','created_by'].forEach((key, i) => row[key] = params[i]); state.payments.push(row); return [{ insertId: row.id }];
      }
      if (/UPDATE expense_payments SET voided_by/.test(text)) { assert(transaction); const row = state.payments.find((entry) => entry.id === params[2]); row.voided_by = params[0]; row.voided_at = '2026-10-11 12:00:00'; row.void_reason = params[1]; return [{ affectedRows: 1 }]; }
    }
    if (type === 'tasks') {
      if (/SELECT \* FROM tasks/.test(text)) return [[...state.records.filter((row) => row.id === params[0] && !row.deleted).map(plain)]];
      if (/UPDATE tasks SET status/.test(text)) {
        assert(transaction); const row = state.records.find((entry) => entry.id === params[3]); row.status = params[0];
        if (params[0] !== 'pending' && !row.started_at) row.started_at = '2026-10-11 08:00:00';
        row.completed_at = params[0] === 'done' ? row.completed_at || '2026-10-11 12:00:00' : null; return [{ affectedRows: 1 }];
      }
    }
    if (type === 'suppliers') {
      if (/SELECT \* FROM suppliers WHERE id/.test(text)) return [[...state.records.filter((row)=>row.id===params[0]&&!row.deleted).map(plain)]];
      if (/INSERT INTO suppliers/.test(text)) { assert(transaction); const row={id:state.records.length+1,deleted:0}; ['supplier_name','contact_name','email','phone','address','category','payment_terms','abn_acn','notes','created_by'].forEach((key,i)=>row[key]=params[i]);state.records.push(row);return[{insertId:row.id}]; }
      if (/UPDATE suppliers SET supplier_name/.test(text)) { assert(transaction); const row=state.records.find((entry)=>entry.id===params[10]); ['supplier_name','contact_name','email','phone','address','category','payment_terms','abn_acn','notes','updated_by'].forEach((key,i)=>row[key]=params[i]);return[{affectedRows:1}]; }
      if (/SELECT COUNT\(\*\) AS total FROM suppliers/.test(text)) return [[{total:state.records.filter((row)=>!row.deleted).length}]];
      if (/SELECT sf.id/.test(text)) return [[]];
      if (/SELECT s\.\*/.test(text)) return [[...state.records.filter((row)=>row.deleted===params[0]).map(plain)]];
    }
    throw new Error('Unexpected ' + type + ' fixture query: ' + text);
  }
  let queue = Promise.resolve();
  const db = { query: (sql, params) => query(sql, params), async getConnection() {
    let snapshot, releaseLock, transaction = false;
    return { query: (sql, params) => query(sql, params, transaction), async beginTransaction() {
      const previous = queue; queue = new Promise((resolve) => { releaseLock = resolve; }); await previous;
      snapshot = plain({ records: state.records, payments: state.payments, receipts:state.receipts, audits: state.audits }); transaction = true;
    }, async commit() { state.commits += 1; transaction = false; releaseLock?.(); }, async rollback() {
      if (transaction) { state.records = snapshot.records; state.payments = snapshot.payments; state.receipts=snapshot.receipts; state.audits = snapshot.audits; state.rollbacks += 1; transaction = false; releaseLock(); }
    }, release() { assert(!transaction, 'a controller must release its transaction'); } };
  } };
  const auth = { hasPermission: (user, permission) => (user.permissions || []).includes(permission), hasAnyPermission: (user, permissions) => permissions.some((permission) => (user.permissions || []).includes(permission)), isManagerOf: async (_manager, userId) => userId === 4 };
  const dependencies = { '../config/db': db, '../services/auditService': { async logAudit(_connection, entry) { if (state.auditFailure) throw new Error('Audit unavailable'); state.audits.push(plain(entry)); } },
    '../services/authorizationService': auth, '../services/originalRegisterSchema': { assertOriginalRegisterSchema: async () => {} }, '../services/trashService': {}, '../services/notificationService': {}, '../utils/dateOnly': dates, '../utils/money': money,
    '../services/expensePaymentDomain': paymentDomain, '../services/expenseRegisterFilters': {}, '../services/sessionService': {}, '../services/documentSecurityService': {}, '../services/documentPdfService': {},
    luxon:require('luxon'),'../services/attendanceTimeService':require('../services/attendanceTimeService'),'../services/attendanceRecordedTotals':require('../services/attendanceRecordedTotals'),'./weeklyTimesheetDeliveryController':{legacySend:()=>{}},'../services/weeklyTimesheetDeliverySchema':{ensureWeeklyTimesheetDeliverySchema:async()=>{}},'../services/workforceSchema': { async ensureWorkforceSchema() {} }, '../services/documentDeliveryService': {}, '../services/timesheetDocumentService': {}, '../services/emailService': {} };
  if(type==='attendance'){
    const actionService=load('services/attendanceActionService.js',{
      '../config/db':db,'./attendanceMobileSchema':{ensureAttendanceMobileSchema:async()=>{}},
      './attendanceTimeService':require('../services/attendanceTimeService'),'./attendanceQrService':{},'./checkoutSummaryService':require('../services/checkoutSummaryService'),
      './attendanceCorrectionService':{assertMutablePeriod:async()=>{}},
      './attendanceMobilePolicy':require('../services/attendanceMobilePolicy'),'./authorizationService':auth,'../utils/dateOnly':dates,
      './auditService':dependencies['../services/auditService'],
      './attendanceDailyService':{readToday:async()=>({status:state.records.some(row=>!row.clock_out&&!row.deleted)?'WORKING':'COMPLETED'})}
    });
    dependencies['../services/attendanceVerifiedSummaryService']=require('../services/attendanceVerifiedSummaryService');
    dependencies['../services/attendanceMobilePolicy']=require('../services/attendanceMobilePolicy');
    dependencies['../services/attendanceActionService']=actionService;
    dependencies['../services/attendanceDailyService']={};dependencies['../services/attendanceQrService']={};
    dependencies['../services/attendanceMobileSchema']={ensureAttendanceMobileSchema:async()=>{}};
    dependencies['../services/attendanceCorrectionService']={assertMutablePeriod:async()=>{},effectiveBreaks:async()=>[],supersedeBreaks:async()=>[]};
  }
  const controller = load('controllers/' + ({ expenses: 'expense', attendance: 'attendance', tasks: 'task', suppliers: 'supplier' }[type]) + 'Controller.js', dependencies);
  async function call(method, body = {}, options = {}) {
    const res = response(); const headers = options.headers || {};
    await controller[method]({ body, query: options.query || {}, params: options.params || {}, user: options.user || { id: 99, permissions: ['EDIT_ATTENDANCE','MANAGE_JOBS'] }, get: (name) => headers[name] || null, ip: '127.0.0.1' }, res); return res;
  }
  return { state, call };
}
async function expenseSafety() {
  const { state, call } = fixture('expenses');
  const body = { expense_date: '2026-10-11', supplier_name: 'Original supplier', description: 'Existing operational expense', amount_ex_gst: '100.00', gst_rate: 10, status: 'unpaid' };
  for (const invalid of [{...body,expense_date:'2026-02-30'},{...body,amount_ex_gst:Infinity},{...body,amount_ex_gst:'1.001'},{...body,gst_rate:Infinity},{...body,status:'invented'},{...body,id:-1}]) assert.equal((await call('saveExpense', invalid)).statusCode, 400);
  assert.equal(state.queries.length, 0, 'invalid expense input must not mutate or migrate records');
  const options = { headers: { 'Idempotency-Key': 'original-expense-fixture-1' } };
  const [first, retry] = await Promise.all([call('saveExpense', body, options),call('saveExpense', body, options)]);
  assert.equal(first.statusCode, 200); assert.equal(retry.body.duplicate, true); assert.equal(first.body.expense_id, retry.body.expense_id); assert.equal(state.records.length, 1); assert.equal(state.audits.length, 1);
  assert.equal((await call('saveExpense', {...body,description:'Different expense'}, options)).statusCode,409);
  const payment = { amount:'60.00',payment_date:'2026-10-11',payment_method:'Card',account_name:'Authorised expense account',idempotency_key:'payment-fixture-1' };
  const paymentOptions = { params: { id: 1 } };
  const recorded = await call('recordExpensePayment', payment, paymentOptions); assert.equal(recorded.statusCode,200); assert.equal(recorded.body.balance_due,50); assert.equal(recorded.body.status,'partially_paid');
  const duplicate = await call('recordExpensePayment', payment, paymentOptions); assert.equal(duplicate.statusCode,200); assert.equal(duplicate.body.duplicate,true); assert.equal(state.payments.length,1);
  assert.equal((await call('recordExpensePayment', {...payment,amount:'61.00'}, paymentOptions)).statusCode,409);
  assert.equal((await call('saveExpense', {...body,id:1,amount_ex_gst:'20.00'})).statusCode,409); assert.equal(state.records[0].total_amount,'110.00');
  const edited = await call('saveExpense', {...body,id:1,amount_ex_gst:'120.00',status:'paid'}); assert.equal(edited.statusCode,200); assert.equal(edited.body.status,'partially_paid','recorded payments govern payment status');
  const beforeFailure = plain(state.records); state.auditFailure = true;
  assert.equal((await call('saveExpense', {...body,id:1,description:'Must roll back'})).statusCode,500); assert.deepEqual(state.records,beforeFailure,'audit failure must roll back the business edit'); state.auditFailure = false;
  const voidOptions = { params: { paymentId: 1 } }; const start = state.queries.length;
  assert.equal((await call('voidExpensePayment',{reason:'Correction'},voidOptions)).statusCode,200);
  assert.equal((await call('voidExpensePayment',{reason:'Correction'},voidOptions)).body.unchanged,true); assert.equal(state.payments.length,1,'reversal preserves the original payment');
  const locks = state.queries.slice(start).filter((entry) => /FOR UPDATE/.test(entry.sql)).map((entry) => entry.sql);
  assert.match(locks[0],/FROM expenses/); assert.match(locks[1],/FROM expense_payments/);
  assert.equal((await call('deleteExpense',{id:1})).statusCode,200); assert.equal(state.records[0].deleted,1);
  assert.equal((await call('restoreExpense',{id:1})).statusCode,200); assert.equal(state.records[0].id,1); assert.equal(state.records[0].deleted,0);
  assert(state.audits.every((entry) => entry.actorId === 99)); assert(!state.queries.some((entry) => /^DELETE|^DROP|^TRUNCATE/.test(entry.sql)), 'original expense workflows cannot erase retained rows');
}
async function attendanceSafety() {
  const { state, call } = fixture('attendance');
  const body = { user_id:4,clock_in:'2026-10-11T08:00',clock_out:'2026-10-11T12:00',notes:'Original staff shift' };
  assert.equal((await call('saveAttendance',body,{user:{id:4,permissions:['VIEW_ATTENDANCE']}})).statusCode,403);
  for (const invalid of [{...body,clock_in:'2026-02-30T08:00'},{...body,clock_out:'2026-10-11T25:00'},{...body,clock_out:'2026-10-10T12:00'},{...body,user_id:Infinity}]) assert.equal((await call('saveAttendance',invalid)).statusCode,422);
  assert.equal(state.queries.length,0,'invalid attendance input cannot write records');
  const saved = await call('saveAttendance',body); assert.equal(saved.statusCode,200); assert.equal(state.records[0].total_minutes,240); assert.equal(state.records[0].total_hours,4);assert.equal(state.records[0].clock_in,'2026-10-10 21:00:00');assert.equal(state.records[0].work_date,'2026-10-11');assert.equal(state.records[0].manual_authorised_by,99);assert.equal(state.records[0].timestamp_basis,'UTC');const retry=await call('saveAttendance',body);assert.equal(retry.body.unchanged,true);assert.equal(state.records.length,1);
  const edit={...body,id:1,expected_revision:1,correction_reason:'Verified actual worked interval',clock_out:'2026-10-11T12:30',break_minutes:15};
  assert.equal((await call('saveAttendance',{...edit,expected_revision:0})).body.code,'ATTENDANCE_REVISION_REQUIRED');
  assert.equal((await call('saveAttendance',{...edit,correction_reason:''})).body.code,'ATTENDANCE_CORRECTION_REASON_REQUIRED');
  assert.equal((await call('saveAttendance',{...edit,user_id:5})).body.code,'ATTENDANCE_OWNER_CHANGE_DENIED');
  const corrected=await call('saveAttendance',edit);assert.equal(corrected.statusCode,200);assert.equal(state.records[0].total_minutes,255);assert.equal(state.records[0].revision,2);assert.equal(state.records[0].user_id,4);assert.equal(state.records[0].review_required,0);assert.equal(state.audits.at(-1).newValue.correction_reason,edit.correction_reason);
  assert.equal((await call('saveAttendance',edit)).body.code,'ATTENDANCE_REVISION_CONFLICT');
  const beforeFailure = plain(state.records); state.auditFailure = true;
  assert.equal((await call('saveAttendance',{...body,clock_in:'2026-10-11T14:00',clock_out:'2026-10-11T15:00'})).statusCode,500); assert.deepEqual(state.records,beforeFailure); state.auditFailure = false;
  state.refreshFailure = true;
  const archived = await call('deleteAttendance',{id:1}); assert.equal(archived.statusCode,200); assert.equal(archived.body.timesheet_status,'pending_refresh'); assert.equal(state.records[0].deleted,1,'saved archive survives reporting refresh failure');
  const archivedList = await call('allAttendance',{}, {query:{archived:'true'}}); assert.equal(archivedList.body.attendance.length,1);
  assert.equal((await call('restoreAttendance',{id:1})).statusCode,200); assert.equal(state.records[0].deleted,0); assert.equal(state.records[0].id,1);
  state.refreshFailure = false;

  for(const [reason,expectedReview] of [['INCOMPLETE_SHIFT_REQUIRES_REVIEW',false],['RECORDED_DURATION_INCONSISTENT',true]]){
    const reviewed=fixture('attendance'),start=require('luxon').DateTime.utc().minus({minutes:60});reviewed.state.records.push({id:1,user_id:4,clock_in:start.toFormat('yyyy-MM-dd HH:mm:ss'),clock_in_utc_text:start.toFormat('yyyy-MM-dd HH:mm:ss'),clock_out:null,work_date:start.setZone('Australia/Sydney').toISODate(),entry_source:'CLOCK',timestamp_basis:'UTC',recorded_timezone:'Australia/Sydney',deleted:0,revision:1,break_minutes:0,total_minutes:0,total_hours:0,review_required:1,review_reason:reason});
    const result=await reviewed.call('clockOut',{request_id:crypto.randomUUID(),attendance_id:1},{user:{id:4,permissions:['VIEW_ATTENDANCE']}});assert.equal(result.statusCode,200);assert.equal(result.body.attendance.review_required,expectedReview,'checkout resolves only the completed incomplete-shift cause');assert.equal(reviewed.state.records[0].review_reason,expectedReview?reason:null);
  }
  const staff = {user:{id:4,permissions:['VIEW_ATTENDANCE']}};
  const legacy=fixture('attendance');legacy.state.records.push({id:1,user_id:4,clock_in:'2020-01-01 08:00:00',clock_out:null,total_minutes:15,total_hours:.25,work_date:'2020-01-01',deleted:0,timestamp_basis:null});const legacyEnded=await legacy.call('clockOut',{request_id:crypto.randomUUID(),attendance_id:1},staff);assert.equal(legacyEnded.statusCode,200);assert.equal(legacyEnded.body.attendance.review_required,true);assert.equal(legacy.state.records[0].clock_out_timestamp_basis,'UTC');assert.equal(legacy.state.records[0].timestamp_basis,null);assert.equal(legacy.state.records[0].clock_in,'2020-01-01 08:00:00');assert.equal(legacy.state.records[0].total_minutes,15);assert.equal(legacy.state.records[0].total_hours,.25);assert.equal(legacy.state.audits[0].action,'CHECK_OUT');
  assert.equal((await call('clockIn',{},staff)).statusCode,422,'legacy clock-in must require a durable retry ID');
  assert.equal((await call('clockOut',{request_id:crypto.randomUUID()},staff)).statusCode,422,'legacy clock-out must name its exact session');
  const request_id=crypto.randomUUID();const [clock1, clock2] = await Promise.all([call('clockIn',{request_id},staff),call('clockIn',{request_id},staff)]); assert.equal(clock1.statusCode,200); assert.equal(clock2.statusCode,200); assert.equal(clock1.body.attendance_id,clock2.body.attendance_id); assert.equal(state.records.filter((row)=>!row.clock_out&&!row.deleted).length,1);
  assert.equal(state.receipts.find(row=>row.request_id===request_id).payload_sha256,require('../services/attendanceMobilePolicy').hash({action:'CHECK_IN',attendance_id:null,task_id:null,category:null,notes:null}),'Existing attendance request hashes remain compatible across this additive summary upgrade');
  assert.equal((await call('saveAttendance',{...body,clock_out:''})).statusCode,409,'a second active shift must not be created');
  assert(!state.queries.some((entry)=>/clock_out = DATE_ADD|total_minutes = 720|total_hours = 12/.test(entry.sql)),'incomplete clocks must never create fabricated 12-hour worked shifts');assert(!state.queries.some((entry)=>/^DELETE|^DROP|^TRUNCATE/.test(entry.sql))); assert(state.audits.every((entry)=>[4,99].includes(entry.actorId)));
}
async function taskSafety() {
  const { state, call } = fixture('tasks'); const staff = {user:{id:4,permissions:['VIEW_OWN_JOBS']}}, other = {user:{id:5,permissions:['VIEW_OWN_JOBS']}};
  assert.equal((await call('updateTaskStatus',{task_id:1,status:'done'},other)).statusCode,403);
  assert.equal((await call('updateTaskStatus',{task_id:1,status:'done'},staff)).statusCode,200); const completedAt = state.records[0].completed_at;
  assert.equal((await call('updateTaskStatus',{task_id:1,status:'done'},staff)).body.unchanged,true); assert.equal(state.records[0].completed_at,completedAt); assert.equal(state.audits.length,1);
  assert.equal((await call('updateTaskStatus',{task_id:1,status:'pending'},staff)).statusCode,409,'staff cannot reopen completed work without manager review');
  const beforeFailure = plain(state.records); state.auditFailure = true; assert.equal((await call('updateTaskStatus',{task_id:1,status:'pending'})).statusCode,500); assert.deepEqual(state.records,beforeFailure); state.auditFailure = false;
  assert.equal((await call('updateTaskStatus',{task_id:1,status:'pending'})).statusCode,200); assert.equal(state.records[0].completed_at,null);
}
async function supplierSafety() {
  const {state,call}=fixture('suppliers');const body={supplier_name:'Original supplier',email:'supplier@example.test',category:'Original materials',notes:'Retained supplier identity'};
  assert.equal((await call('saveSupplier',{...body,email:'bad email'})).statusCode,400);assert.equal((await call('saveSupplier',{...body,supplier_name:'a'.repeat(181)})).statusCode,400);assert.equal(state.queries.length,0);
  const created=await call('saveSupplier',body);assert.equal(created.statusCode,200);assert.equal(created.body.supplier_id,1);state.records[0].historical_reference='PO-ORIGINAL-1';
  const edited=await call('saveSupplier',{...body,id:1,notes:'Approved supplier notes'});assert.equal(edited.statusCode,200);assert.equal(edited.body.supplier_id,1);assert.equal(state.records[0].historical_reference,'PO-ORIGINAL-1');assert.equal(state.audits.length,2);
  const before=plain(state.records);state.auditFailure=true;assert.equal((await call('saveSupplier',{...body,id:1,notes:'Must roll back'})).statusCode,500);assert.deepEqual(state.records,before);state.auditFailure=false;
  const search="' OR 1=1 --";const listed=await call('getSuppliers',{}, {query:{search,page:1,limit:20,sort:'name',direction:'desc'}});assert.equal(listed.statusCode,200);assert.equal(listed.body.pagination.total,1);
  const query=state.queries.find((entry)=>/^SELECT s\.\*/.test(entry.sql));assert(!query.sql.includes(search));assert.equal(query.params[1],'%'+search+'%');assert.match(query.sql,/ORDER BY s.supplier_name DESC, s.id DESC LIMIT \? OFFSET \?/);
}
function explicitPaymentPermissions() {
  for(const permission of ['POST_TRANSACTION','VOID_TRANSACTION']) {
    const allowed = requireAnyPermission(permission), denied = response(); let proceeded = false;
    allowed({user:{id:4,role:'staff',permissions:['VIEW_FINANCE','EDIT_FINANCE']}},denied,()=>{proceeded=true;}); assert.equal(denied.statusCode,403); assert.equal(proceeded,false);
  }
}
function recruitmentAuthority() {
  const routers = [];
  const middleware = require('../middleware/authorizationMiddleware');
  const multer = () => ({ single: () => (_req, _res, next) => next() }); multer.diskStorage = (value) => value;
  load('routes/careersRoutes.js', { express: { Router() { const router = { routes: [], use() {}, get() {}, post() {}, patch(route,...handlers) { this.routes.push({ route, handlers }); } }; routers.push(router); return router; } },
    '../controllers/careersController': {}, multer, '../middleware/uploadSecurity': { secureMulterOptions: (value) => value }, '../middleware/authorizationMiddleware': middleware,
    '../middleware/securityMiddleware': { rateLimit: () => (_req, _res, next) => next() } });
  for(const {handlers} of routers.flatMap((router)=>router.routes)) {
    let proceeded=false; const res=response(); handlers[0]({user:{id:4,role:'staff',permissions:['VIEW_STAFF_HR']}},res,()=>{proceeded=true;});
    assert.equal(res.statusCode,403,'viewing recruitment must not authorize changing candidate status'); assert.equal(proceeded,false);
  }
}
(async()=>{await expenseSafety();await attendanceSafety();await taskSafety();await supplierSafety();explicitPaymentPermissions();recruitmentAuthority();console.log('Staff/expense tests passed: field validation, atomic audit rollback, safe expense/payment retries, amount protection, consistent lock ordering, retained archive/restore, concurrent clock-in dedupe, refresh failure recovery, supplier identity/audit/search, task owner/reopen authority, recruitment write authority and explicit payment permission boundaries.');})().catch((error)=>{console.error(error);process.exitCode=1;});
