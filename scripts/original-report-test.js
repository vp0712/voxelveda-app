'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const authorization = require('../services/authorizationService');
const pdfService = require('../services/documentPdfService');

function plain(value) { return JSON.parse(JSON.stringify(value)); }
const UUID = 'cfa0c8a0-4e19-4f47-b4d4-64d84a56b777';
const RECORDS = {
  rfqs: Array.from({ length: 205 }, (_, index) => ({ id: index + 1, customer_name: `Fixture customer ${index + 1}`, email: 'rfq@example.test', material: 'Original nylon', quantity: index + 1, status: 'pending', created_at: '2026-10-01', user_uuid: UUID, pdf_status: 'DEBUG_GENERATION_STATUS' })),
  invoices: [{ id: 1, invoice_no: 'FIXTURE-INV-A', customer_name: 'Fixture customer', status: 'paid', total: '1.10', created_at: '2026-10-01' }, { id: 2, invoice_no: 'FIXTURE-INV-B', customer_name: 'Fixture customer', status: 'sent', total: '2.20', created_at: '2026-10-02' }],
  customers: [{ id: 1, company_name: 'Fixture customer company', contact_name: 'Original contact', email: 'customer@example.test', phone: '0400000000' }],
  suppliers: [{ id: 1, supplier_name: 'Fixture supplier', contact_name: 'Supplier contact', email: 'supplier@example.test', phone: '0400000001', files: [{ id: UUID, title: 'Unused supplier metadata' }] }],
  stock: [{ id: 1, product_name: 'Fixture precision part', batch_code: 'FIXTURE-BATCH', unit_qty: 50, current_unit_qty: 40, unit_price: '12.50' }],
  materials: [{ id: 1, item_name: 'Fixture original raw material', inventory_type: 'raw_material', unit_label: 'kg', current_qty: '3.125', unit_price: '8.50' }, { id: 2, item_name: 'Fixture original packaging', inventory_type: 'packaging', unit_label: 'pcs', current_qty: '12.000', unit_price: '1.25' }],
  users: [{ id: 4, employee_number: 'FIXTURE-EMP-4', name: 'Fixture staff member', department: 'Original production', role: 'staff', email: 'staff@example.test', active: true, user_uuid: UUID, permissions: ['DEBUG_PRIVATE_PERMISSION'], active_session_count: 8 }],
  competitors: [{ id: 1, company_name: 'Fixture industry organisation', category: 'Original additive manufacturing', country: 'Australia', website: 'https://example.test' }],
  roster: [{ id: 1, user_id: 4, staff_name: 'Fixture roster staff', shift_date: '2026-10-01', start_time: '08:00:00', end_time: '16:00:00', location: 'Original workshop', status: 'scheduled', staff_email: 'private-roster@example.test' }, { id: 2, user_id: 5, staff_name: 'Excluded roster staff', shift_date: '2026-10-02', start_time: '09:00:00', end_time: '17:00:00', location: 'Original office', status: 'published', staff_email: 'excluded-roster@example.test' }],
  expenses: [{ id: 1, expense_date: '2026-10-01', supplier_name: 'Fixture supplier', invoice_no: 'FIXTURE-BILL-A', total_amount: '4.30', status: 'paid' }, { id: 2, expense_date: '2026-10-02', supplier_name: 'Fixture supplier', invoice_no: 'FIXTURE-BILL-B', total_amount: '5.60', status: 'pending' }]
};
const SOURCES = {
  rfq: ['getRFQs', 'rfqs', true], invoice: ['getInvoices', 'invoices', true], customer: ['getCustomers', 'customers', true], supplier: ['getSuppliers', 'suppliers', false], stock: ['getStock', 'stock', true], material: ['getMaterials', 'materials', true], user: ['getUsers', 'users', false], competitor: ['getCompetitors', 'competitors', false], roster: ['listRoster', 'roster', false], expense: ['getExpenses', 'expenses', true]
};
const ATTENDANCE_USERS = [
  { id: 4, name: 'Fixture own staff', manager_id: 10, active: 1, deleted_at: null },
  { id: 5, name: 'Fixture team staff', manager_id: 10, active: 1, deleted_at: null },
  { id: 6, name: 'Outside authorised team', manager_id: 20, active: 1, deleted_at: null },
  { id: 7, name: 'Inactive team staff', manager_id: 10, active: 0, deleted_at: null },
  { id: 10, name: 'Fixture manager own', manager_id: 20, active: 1, deleted_at: null }
];
const ATTENDANCE = ATTENDANCE_USERS.map((user, index) => ({ id: index + 1, user_id: user.id, name: user.name, work_date: index === 1 ? '2026-10-02' : '2026-10-01', clock_in: '2026-10-01T01:00:00Z', clock_out: '2026-10-01T09:00:00Z', total_hours: index + 4, deleted: 0 }));

async function reportFixture(options = {}) {
  const state = { sourceReads: [], queries: [], pdfCalls: [], rows: plain(ATTENDANCE), records: plain(RECORDS) };
  const db = { async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim(); state.queries.push({ sql: normalized, params: [...params] });
    assert.match(normalized, /^SELECT\b/, 'reporting must not clock-out shifts, reconcile timesheets or mutate business records');
    if (/SELECT id FROM users WHERE/.test(normalized)) return [[...ATTENDANCE_USERS.filter((user) => user.id === Number(params[0]) && user.manager_id === Number(params[1]) && user.active && !user.deleted_at).map((user) => ({ id: user.id }))]];
    assert.match(normalized, /FROM staff_attendance a JOIN users u/);
    let rows = state.rows.filter((row) => !row.deleted), offset = 0;
    if (/u.manager_id=\?/.test(normalized)) {
      const managerId = Number(params[offset++]), ownId = /OR a.user_id=\?/.test(normalized) ? Number(params[offset++]) : null;
      rows = rows.filter((row) => { const user = ATTENDANCE_USERS.find((candidate) => candidate.id === row.user_id); return (user.manager_id === managerId && user.active && !user.deleted_at) || row.user_id === ownId; });
    } else if (/AND a.user_id=\?/.test(normalized)) { const id = Number(params[offset++]); rows = rows.filter((row) => row.user_id === id); }
    if (/a.work_date>=\?/.test(normalized)) { const from = params[offset++]; rows = rows.filter((row) => row.work_date >= from); }
    if (/a.work_date<=\?/.test(normalized)) { const to = params[offset++]; rows = rows.filter((row) => row.work_date <= to); }
    assert.equal(offset, params.length, 'every requested staff/date filter must be bound and consumed');
    return [rows.slice(0, 10001)];
  } };
  const sourceModules = {};
  for (const [module, [method, key, paginated]] of Object.entries(SOURCES)) {
    sourceModules[`./${module}Controller`] = { async [method](req, res) {
      state.sourceReads.push({ module, method, req: { query: plain(req.query), user: plain(req.user), params: plain(req.params) } });
      if (options.sourceHandler) { const result = await options.sourceHandler(module, req, state); if (result) return res.status(result.status || 200).json(result.body); }
      let rows = state.records[key];
      if (module === 'material') rows = rows.filter((row) => row.inventory_type === req.query.type);
      if (module === 'rfq' && req.user.role === 'customer') rows = rows.filter((row) => row.email === req.user.email);
      const page = Number(req.query.page || 1), limit = Number(req.query.limit || 100);
      const batch = paginated ? rows.slice((page - 1) * limit, page * limit) : rows;
      const metadata = { total: rows.length, page, limit };
      const body = { [key]: batch };
      if (paginated) Object.assign(body, ['customer', 'material', 'stock'].includes(module) ? { pagination: metadata } : metadata);
      return res.json(body);
    } };
  }
  const fixtureModule = { exports: {} };
  const dependencies = {
    '../config/db': db, '../services/authorizationService': authorization,
    '../services/customerRecordScope': require('../services/customerRecordScope'),
    '../services/attendanceRecordedTotals': require('../services/attendanceRecordedTotals'),
    '../services/documentPdfService': { ...pdfService, async createDocumentPdf(data) { state.pdfCalls.push(plain(data)); return options.corruptArtifact ? { buffer: Buffer.from('<html>invalid PDF</html>'), filename: 'error.pdf' } : pdfService.createDocumentPdf(data); } },
    ...sourceModules
  };
  const filename = path.join(__dirname, '../controllers/originalReportController.js');
  new vm.Script(await fs.readFile(filename, 'utf8'), { filename }).runInNewContext({ module: fixtureModule, exports: fixtureModule.exports, Buffer, Date, Intl, process: { env: { TIMESHEET_TIMEZONE: options.timezone || 'UTC' } }, require(name) { if (!Object.hasOwn(dependencies, name)) throw new Error('Unexpected report dependency: ' + name); return dependencies[name]; } });
  async function download(type, query = {}, user = { id: 99, role: 'admin' }) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, send(value) { this.bytes = value; return this; } };
    let error;
    await fixtureModule.exports.download({ params: { type }, query, user }, res, (value) => { error = value; });
    return { res, error };
  }
  return { download, state, controller: fixtureModule.exports };
}

async function registerPdfEvidence() {
  const fixture = await reportFixture(), paths = [], evidence = [];
  const expected = { rfqs: 'Fixture customer 205', invoices: 'AUD 3.30', customers: 'Fixture customer company', suppliers: 'Fixture supplier', stock: 'Units available', materials: 'Fixture original packaging', staff: 'FIXTURE-EMP-4', competitors: 'Original additive manufacturing', roster: 'Fixture roster staff', expenses: 'AUD 9.90' };
  const output = process.env.PDF_FIXTURE_OUTPUT || '/tmp/voxel-pdf-evidence'; await fs.mkdir(output, { recursive: true });
  for (const [type, identity] of Object.entries(expected)) {
    const query = type === 'roster' ? { from_date: '2026-10-01', to_date: '2026-10-01', user_id: '4', download: '1' } : { download: '1' };
    const { res, error } = await fixture.download(type, query);
    assert.equal(error, undefined, `${type}: ${error?.message}`);
    assert(Buffer.isBuffer(res.bytes)); assert.equal(res.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(res.headers['Content-Type'], 'application/pdf'); assert.match(res.headers['Content-Disposition'], /^attachment; filename="[A-Z]+-\d{8}\.pdf"$/);
    assert.equal(res.headers['Content-Length'], res.bytes.length); assert.equal(res.headers['Cache-Control'], 'private, no-store');
    const parsed = await pdfService.validatePdf(res.bytes, { expectedText: [identity] });
    assert(parsed.pages >= 1);
    assert.doesNotMatch(parsed.text, new RegExp(UUID)); assert.doesNotMatch(parsed.text, /DEBUG_GENERATION_STATUS|DEBUG_PRIVATE_PERMISSION|Unused supplier metadata|PDF status|Download PDF/i);
    if (type === 'rfqs') { assert(parsed.pages > 1); assert.match(parsed.text, /205 records/); assert.equal(fixture.state.sourceReads.filter((read) => read.module === 'rfq').length, 3); }
    if (type === 'materials') { assert.match(parsed.text, /Raw material/); assert.match(parsed.text, /Packaging/); assert.match(parsed.text, /kg/); assert.match(parsed.text, /pcs/); assert.match(parsed.text, /3\.125/); assert.match(parsed.text, /2 records/); }
    if (type === 'roster') { assert.doesNotMatch(parsed.text, /Excluded roster staff|private-roster@example|excluded-roster@example/); assert.match(parsed.text, /08:00/); assert.match(parsed.text, /1 Oct 2026/); assert.match(parsed.text, /1 record/); }
    const destination = path.join(output, `report-${type}.pdf`); await fs.writeFile(destination, res.bytes); paths.push(destination); evidence.push({ type, pages: parsed.pages, bytes: parsed.bytes });
  }
  const preview = await fixture.download('materials', { type: 'packaging', download: '0' });
  assert.equal(preview.error, undefined); assert.match(preview.res.headers['Content-Disposition'], /^inline; filename=".*\.pdf"$/);
  const packaging = await pdfService.validatePdf(preview.res.bytes); assert.match(packaging.text, /Fixture original packaging/); assert.doesNotMatch(packaging.text, /Fixture original raw material/);
  return { paths, evidence };
}

async function completenessFailures() {
  const cases = [
    { body: { customers: [{ id: 1 }], pagination: { total: 101, page: 1, limit: 100 } }, status: 422, code: 'REPORT_SOURCE_INCOMPLETE' },
    { body: { customers: [], pagination: { total: 10001, page: 1, limit: 100 } }, status: 422, code: 'REPORT_LIMIT_EXCEEDED' },
    { body: { customers: [{ id: 1 }] }, status: 502, code: 'REPORT_PAGINATION_INVALID' },
    { body: { customers: [{ id: 1 }], pagination: { total: 1, page: 1, limit: 25 } }, status: 502, code: 'REPORT_PAGINATION_INVALID' },
    { body: { customers: [{ id: 1 }, { id: 1 }], pagination: { total: 2, page: 1, limit: 100 } }, status: 409, code: 'REPORT_SOURCE_CHANGED' },
    { body: { records: [] }, status: 502, code: 'REPORT_SOURCE_INVALID' }
  ];
  for (const scenario of cases) {
    const fixture = await reportFixture({ sourceHandler: () => ({ body: scenario.body }) });
    const { res, error } = await fixture.download('customers');
    assert.equal(error?.status, scenario.status); assert.equal(error?.code, scenario.code); assert.equal(res.bytes, undefined); assert.equal(fixture.state.pdfCalls.length, 0, 'incomplete sources must fail before document generation');
  }
  for (const mode of ['changed', 'empty', 'duplicate']) {
    const fixture = await reportFixture({ sourceHandler: (_module, req) => {
      const page = Number(req.query.page);
      return { body: { customers: page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) : mode === 'empty' ? [] : [{ id: mode === 'duplicate' ? 100 : 101 }], pagination: { total: page > 1 && mode === 'changed' ? 102 : 101, page, limit: 100 } } };
    } });
    const { res, error } = await fixture.download('customers'); assert.equal(error?.code, mode === 'empty' ? 'REPORT_SOURCE_INCOMPLETE' : 'REPORT_SOURCE_CHANGED'); assert.equal(res.bytes, undefined);
  }
  const failedSource = await reportFixture({ sourceHandler: () => ({ status: 503, body: { message: 'Fixture database unavailable' } }) });
  assert.equal((await failedSource.download('stock')).error.status, 503); assert.equal(failedSource.state.pdfCalls.length, 0);
  const corrupt = await reportFixture({ corruptArtifact: true });
  const invalid = await corrupt.download('stock'); assert.equal(invalid.error.code, 'PDF_DOCUMENT_INVALID'); assert.equal(invalid.res.bytes, undefined); assert.equal(invalid.res.headers['Content-Type'], undefined, 'invalid bytes cannot be presented as a PDF response');
}

async function authoritiesAndFilters() {
  const fixture = await reportFixture();
  for (const type of [...Object.keys(SOURCES).map((module) => ({ rfq: 'rfqs', invoice: 'invoices', customer: 'customers', supplier: 'suppliers', material: 'materials', user: 'staff', competitor: 'competitors', expense: 'expenses' }[module] || module)), 'timesheets']) {
    const before = fixture.state.sourceReads.length + fixture.state.queries.length;
    const denied = await fixture.download(type, {}, { id: 4, role: 'viewer' });
    assert.equal(denied.error.status, 403, `viewer must not download ${type}`); assert.equal(denied.res.bytes, undefined); assert.equal(fixture.state.sourceReads.length + fixture.state.queries.length, before);
  }
  assert.equal((await fixture.download('staff', {}, { id: 4, role: 'hr' })).error.status, 403, 'HR view grant cannot bypass account-management route authority');
  assert.equal((await fixture.download('roster', {}, { id: 4, role: 'viewer', permissions: ['VIEW_ATTENDANCE'] })).error.status, 403);
  assert.equal((await fixture.download('roster', {}, { id: 4, role: 'viewer', permissions: ['EDIT_ATTENDANCE'] })).error.status, 403);
  for (const type of ['constructor', 'toString', 'banking', 'erp']) assert.equal((await fixture.download(type)).error.status, 404);
  for (const query of [{ page: '2' }, { limit: '1' }, { sort: 'toString' }, { direction: 'invalid' }, { search: ['one', 'two'] }, { download: 'tmp' }]) assert.equal((await fixture.download('customers', query)).error.status, 400);
  assert.equal((await fixture.download('roster', { from_date: '2026-02-30' })).error.status, 400);
  assert.equal((await fixture.download('roster', { from_date: '2026-10-03', to_date: '2026-10-01' })).error.status, 400);
  const clients = await reportFixture(); clients.state.records.rfqs = [plain(RECORDS.rfqs[0]), { ...plain(RECORDS.rfqs[1]), email: 'outside@example.test', customer_name: 'Outside client record' }];
  const scoped = await clients.download('rfqs', { q: 'Original' }, { id: 4, role: 'customer', email: 'rfq@example.test', permissions: ['VIEW_RFQS'] });
  assert.equal(scoped.error, undefined); const parsed = await pdfService.validatePdf(scoped.res.bytes); assert.doesNotMatch(parsed.text, /Outside client record/); assert.equal(clients.state.sourceReads[0].req.user.email, 'rfq@example.test', 'report source must retain full authenticated scope'); assert.equal(clients.state.sourceReads[0].req.query.q, 'Original');
}

async function attendanceScopesAndDates() {
  const fixture = await reportFixture();
  const ownUser = { id: 4, role: 'viewer', permissions: ['VIEW_OWN_TIMESHEET'] };
  const own = await fixture.download('timesheets', { from_date: '2026-10-01', to_date: '2026-10-01', download: '1' }, ownUser);
  assert.equal(own.error, undefined); const ownText = (await pdfService.validatePdf(own.res.bytes)).text;
  assert.match(ownText, /Fixture own staff/); assert.doesNotMatch(ownText, /Fixture team staff|Outside authorised team|Inactive team staff|Fixture manager own/);
  assert.match(ownText, /1\/10\/26, 1:00 am/); assert.match(ownText, /1\/10\/26, 9:00 am/); assert.match(ownText, /Clock times: UTC/); assert.match(ownText, /Recorded hours: 4\.00/);
  assert.match(ownText, /Review and approval status must be confirmed/); assert.doesNotMatch(ownText, /Approved by/);
  const outside = await fixture.download('timesheets', { user_id: '6' }, ownUser); assert.equal(outside.error.status, 403); assert.equal(outside.res.bytes, undefined);
  const teamUser = { id: 10, role: 'viewer', permissions: ['VIEW_TEAM_TIMESHEET'] };
  const team = await fixture.download('timesheets', {}, teamUser); assert.equal(team.error, undefined); const teamText = (await pdfService.validatePdf(team.res.bytes)).text;
  assert.match(teamText, /Fixture own staff/); assert.match(teamText, /Fixture team staff/); assert.doesNotMatch(teamText, /Outside authorised team|Inactive team staff|Fixture manager own/);
  const teamOwn = await fixture.download('timesheets', {}, { ...teamUser, permissions: ['VIEW_TEAM_TIMESHEET', 'VIEW_OWN_TIMESHEET'] });
  assert.equal(teamOwn.error, undefined); assert.match((await pdfService.validatePdf(teamOwn.res.bytes)).text, /Fixture manager own/);
  const individualTeam = await fixture.download('timesheets', { user_id: '5', from: '2026-10-02', to: '2026-10-02' }, teamUser); assert.equal(individualTeam.error, undefined); const filtered = (await pdfService.validatePdf(individualTeam.res.bytes)).text; assert.match(filtered, /Fixture team staff/); assert.doesNotMatch(filtered, /Fixture own staff/);
  const teamDenied = await fixture.download('timesheets', { user_id: '6' }, teamUser); assert.equal(teamDenied.error.status, 403);
  const inactiveDenied = await fixture.download('timesheets', { user_id: '7' }, teamUser); assert.equal(inactiveDenied.error.status, 403, 'single and aggregate team scopes must consistently exclude inactive assignments');
  const all = await fixture.download('timesheets', {}, { id: 99, role: 'viewer', permissions: ['VIEW_ALL_TIMESHEETS'] }); assert.equal(all.error, undefined); assert.match((await pdfService.validatePdf(all.res.bytes)).text, /Inactive team staff/);
  for (const query of [{ from_date: '2026-02-30' }, { from_date: '2026-10-02', to_date: '2026-10-01' }, { from_date: '2026-10-01', from: '2026-10-02' }, { user_id: 'NaN' }, { user_id: true }]) assert.equal((await fixture.download('timesheets', query, ownUser)).error.status, 400);
  const minuteFixture=await reportFixture();
  minuteFixture.state.rows=Array.from({length:12},(_,index)=>({...plain(ATTENDANCE[0]),id:100+index,timestamp_basis:'UTC',total_minutes:50,total_hours:0.83,
    clock_in:new Date(Date.parse('2026-10-01T01:00:00Z')+index*50*60000).toISOString(),clock_out:new Date(Date.parse('2026-10-01T01:00:00Z')+(index+1)*50*60000).toISOString()}));
  const minuteReport=await minuteFixture.download('timesheets',{},ownUser);
  assert.equal(minuteReport.error,undefined);
  assert.match((await pdfService.validatePdf(minuteReport.res.bytes)).text,/Recorded hours: 10\.00/,'Consolidate actual worked minutes before rounding the report total.');
  fixture.state.rows[0].total_hours = Infinity;
  assert.equal((await fixture.download('timesheets', {}, ownUser)).error.code, 'REPORT_DATA_INVALID');
  fixture.state.rows = Array.from({ length: 10001 }, (_, index) => ({ ...plain(ATTENDANCE[0]), id: index + 1 }));
  const oversized = await fixture.download('timesheets', {}, ownUser); assert.equal(oversized.error.code, 'REPORT_LIMIT_EXCEEDED'); assert.equal(oversized.res.bytes, undefined);
  assert(fixture.state.queries.every(({ sql }) => /^SELECT\b/.test(sql)));
  const invalidTimezone = await reportFixture({ timezone: 'Not/A_Timezone' }); assert.equal((await invalidTimezone.download('timesheets', {}, ownUser)).error.code, 'REPORT_TIMEZONE_INVALID');
  const output = process.env.PDF_FIXTURE_OUTPUT || '/tmp/voxel-pdf-evidence'; await fs.writeFile(path.join(output, 'report-timesheets.pdf'), own.res.bytes);
}

async function httpDownloadContract() {
  const express = require('express');
  const fixture = await reportFixture();
  const app = express();
  app.get('/api/documents/reports/:type.pdf', (req, _res, next) => { req.user = { id: 99, role: 'admin' }; next(); }, fixture.controller.download);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message, code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}/api/documents/reports`;
  try {
    const response = await fetch(`${base}/stock.pdf?download=1`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="STOCK-\d{8}\.pdf"$/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get('content-length')), bytes.length);
    await pdfService.validatePdf(bytes, { expectedText: ['Stock register', 'Fixture precision part', 'FIXTURE-BATCH', 'AUD 12.50'] });
    const invalid = await fetch(`${base}/stock.pdf?download=tmp`);
    assert.equal(invalid.status, 400); assert.match(invalid.headers.get('content-type'), /application\/json/); assert.equal(invalid.headers.get('content-disposition'), null);
    const retired = await fetch(`${base}/banking.pdf`); assert.equal(retired.status, 404);
    const originalApp = await fs.readFile(path.join(__dirname, '../app.js'), 'utf8');
    assert.match(originalApp, /app\.get\('\/api\/documents\/reports\/:type\.pdf',\s*auth,\s*require\('\.\/controllers\/originalReportController'\)\.download\)/, 'the real application must mount this report endpoint after authentication');
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function main() {
  const evidence = await registerPdfEvidence(); await completenessFailures(); await authoritiesAndFilters(); await attendanceScopesAndDates(); await httpDownloadContract();
  console.log(`Original report tests passed: ${evidence.evidence.length} original registers plus timesheet PDFs parsed; 205 RFQs across all three source pages; correct units/category/date/time columns and exact money totals; actual HTTP PDF download bytes and metadata; source completeness failures block partial documents; invalid bytes rejected; role/client/own/team/all scope; filtered read-only attendance and roster; no UUID/security metadata in document body. Fixtures: ${evidence.paths[0].replace(/report-rfqs\.pdf$/, '')}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
