'use strict';
const { hasPermission, canAccessUserRecord } = require('../services/authorizationService');
const { createDocumentPdf, sendPdfResponse, dateLabel, money } = require('../services/documentPdfService');
const pool = require('../config/db');
const {attendanceRecordedHours}=require('../services/attendanceRecordedTotals');

// Each source is an original application register. Explicit response contracts
// prevent unrelated fallback arrays or an incomplete page becoming a report.
const REPORTS = Object.freeze({
  rfqs: { title: 'RFQ register', module: 'rfq', method: 'getRFQs', key: 'rfqs', permission: 'VIEW_RFQS', paginated: true,
    filters: ['q', 'status', 'archived'], sorts: ['id', 'customer', 'status', 'created', 'quantity'],
    columns: [['Customer', 'customer_name', 2.5], ['Email', 'email', 2.5], ['Material', 'material', 2], ['Qty', 'quantity', 1, 'number'], ['Status', 'status', 1], ['Created', 'created_at', 1.6, 'date']] },
  invoices: { title: 'Invoice register', module: 'invoice', method: 'getInvoices', key: 'invoices', permission: 'VIEW_FINANCE', paginated: true,
    filters: ['search', 'status', 'payment_state', 'from','to','archived'], sorts: ['id', 'date', 'customer', 'total', 'balance', 'reference'],
    columns: [['Reference', 'invoice_no', 2], ['Customer', 'customer_name', 2.5], ['Status', 'status', 1.2], ['Total (AUD)', 'total', 1.8, 'moneyReview'],['Paid (AUD)','paid_amount',1.8,'moneyReview'],['Outstanding (AUD)','balance_due',1.8,'moneyReview'],['Payment','payment_state',1.8,'paymentState'], ['Created', 'created_at', 1.7, 'date']], total: ['Invoice value', 'total'] },
  customers: { title: 'Customer register', module: 'customer', method: 'getCustomers', key: 'customers', permission: 'VIEW_CUSTOMERS', paginated: true,
    filters: ['search'], sorts: ['id', 'company_name', 'contact_name', 'created_at', 'order_count', 'total_spend'],
    columns: [['Company', 'company_name', 3], ['Contact', 'contact_name', 2], ['Email', 'email', 3], ['Phone', 'phone', 2]] },
  suppliers: { title: 'Supplier register', module: 'supplier', method: 'getSuppliers', key: 'suppliers', permission: 'VIEW_SUPPLIERS', paginated: false,
    filters: ['search'], sorts: ['id', 'supplier_name', 'contact_name', 'email'],
    columns: [['Supplier', 'supplier_name', 3], ['Contact', 'contact_name', 2], ['Email', 'email', 3], ['Phone', 'phone', 2]] },
  stock: { title: 'Stock register', module: 'stock', method: 'getStock', key: 'stock', permission: 'VIEW_INVENTORY', paginated: true,
    filters: ['search', 'category', 'availability'], sorts: ['id', 'product_name', 'batch_code', 'current_unit_qty', 'created_at'],
    columns: [['Product', 'product_name', 2.5], ['Batch', 'batch_code', 1.7], ['Units received', 'unit_qty', 1.5, 'number'], ['Units available', 'current_unit_qty', 1.5, 'number'], ['Unit price (AUD)', 'unit_price', 1.8, 'money']] },
  materials: { title: 'Material inventory register', module: 'material', method: 'getMaterials', key: 'materials', permission: 'VIEW_INVENTORY', paginated: true,
    filters: ['type', 'inventory_type', 'search', 'stock_status'], sorts: ['id', 'item_name', 'supplier', 'current_qty', 'current_value', 'created_at'],
    columns: [['Item', 'item_name', 2.8], ['Type', 'inventory_type', 1.7, 'materialType'], ['Unit', 'unit_label', 1], ['Available quantity', 'current_qty', 1.6, 'number'], ['Unit price (AUD)', 'unit_price', 1.9, 'money']] },
  staff: { title: 'Staff register', module: 'user', method: 'getUsers', key: 'users', permission: 'MANAGE_USERS', paginated: false,
    filters: ['search', 'department', 'role', 'active'], sorts: ['id', 'employee_number', 'name', 'department', 'role', 'email'],
    columns: [['Employee', 'employee_number', 1.5], ['Name', 'name', 2.5], ['Department', 'department', 2], ['Role', 'role', 1.5], ['Email', 'email', 3]] },
  competitors: { title: 'Industry directory', module: 'competitor', method: 'getCompetitors', key: 'competitors', permission: 'VIEW_CUSTOMERS', paginated: false,
    filters: ['search', 'category', 'country'], sorts: ['id', 'company_name', 'category', 'country', 'website'],
    columns: [['Company', 'company_name', 3], ['Category', 'category', 2.5], ['Country', 'country', 1.5], ['Website', 'website', 3]] },
  roster: { title: 'Roster report', module: 'roster', method: 'listRoster', key: 'roster', permission: ['VIEW_ATTENDANCE', 'EDIT_ATTENDANCE'], paginated: false,
    filters: ['user_id', 'from_date', 'to_date', 'status'], sorts: ['id', 'staff_name', 'shift_date', 'start_time', 'status'],
    columns: [['Staff', 'staff_name', 2], ['Date', 'shift_date', 1.6, 'date'], ['Start', 'start_time', 1, 'time'], ['End', 'end_time', 1, 'time'], ['Location', 'location', 2], ['Status', 'status', 1.4]] }
});
// Expenses use the original supplier-bill register; this does not load Finance OS.
const EXPENSE_REPORT = Object.freeze({ title: 'Expense register', module: 'expense', method: 'getExpenses', key: 'expenses', permission: 'VIEW_FINANCE', paginated: true,
  filters: ['search', 'supplier', 'category', 'status', 'fy', 'from', 'to', 'id'], sorts: [],
  columns: [['Date', 'expense_date', 1.5, 'date'], ['Supplier', 'supplier_name', 2.5], ['Reference', 'invoice_no', 1.8], ['Total (AUD)', 'total_amount', 1.7, 'money'], ['Status', 'status', 1.3]], total: ['Recorded expense value', 'total_amount'] });
const MAX_RECORDS = 10000;
const PAGE_SIZE = 100;

function reportError(message, status = 400, code = 'REPORT_REQUEST_INVALID') {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}
async function capture(handler, req) {
  let status = 200, body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; }, set() { return this; }, setHeader() { return this; } };
  if (typeof handler !== 'function') throw reportError('The report source is unavailable.', 502, 'REPORT_SOURCE_INVALID');
  await handler(req, res);
  if (status !== 200 || !body) throw reportError(body?.message || 'Report source could not be loaded. Retry after resolving the source error.', status >= 400 ? status : 502, 'REPORT_SOURCE_FAILED');
  return body;
}
function date(value, field) {
  if (!value) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text + 'T00:00:00Z')) || new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) !== text) throw reportError(`Enter a valid ${field} date in YYYY-MM-DD format.`);
  return text;
}
function selectedUser(value) {
  if (!value) return null;
  if (!['number', 'string'].includes(typeof value)) throw reportError('Select a valid staff member.');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw reportError('Select a valid staff member.');
  return id;
}
function requestQuery(req, definition, timesheets = false) {
  const query = {};
  const allowed = new Set(['download', ...(timesheets ? ['user_id', 'from_date', 'to_date', 'from', 'to'] : [...definition.filters, 'sort', 'direction'])]);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (!allowed.has(key)) throw reportError(`The ${key} filter is not supported for this report. No document was downloaded.`);
    if (!['string', 'number'].includes(typeof value)) throw reportError(`Use a single value for the ${key} filter.`);
    if (String(value).length > 255) throw reportError(`The ${key} filter is too long.`);
    if (String(value).trim()) query[key] = String(value).trim();
  }
  if (query.download !== undefined && !['0', '1'].includes(query.download)) throw reportError('Download must be 0 or 1.');
  if (!timesheets) {
    if (query.sort && !definition.sorts.includes(query.sort)) throw reportError('Choose a supported report sort field.');
    if (query.direction && !['asc', 'desc'].includes(query.direction)) throw reportError('Sort direction must be asc or desc.');
  }
  return query;
}
function periodText(from, to, fallback) {
  return from || to ? `${from ? dateLabel(from) : 'First record'} to ${to ? dateLabel(to) : 'Latest record'}` : fallback;
}
function recordDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}
function assertRecordLimit(count) {
  if (count > MAX_RECORDS) throw reportError('Choose narrower filters; this report exceeds 10,000 records.', 422, 'REPORT_LIMIT_EXCEEDED');
}

async function completeRegister(definition, req, query) {
  const handler = require('./' + definition.module + 'Controller')[definition.method];
  const rows = [], seen = new Set();
  let expectedTotal = null;
  for (let page = 1; page <= Math.ceil(MAX_RECORDS / PAGE_SIZE); page += 1) {
    const body = await capture(handler, { ...req, query: { ...query, ...(definition.paginated ? { page: String(page), limit: String(PAGE_SIZE) } : {}) } });
    const batch = body[definition.key];
    if (!Array.isArray(batch)) throw reportError('The report source returned an unexpected response. No document was downloaded.', 502, 'REPORT_SOURCE_INVALID');
    if (!definition.paginated) return batch;
    const metadata = body.pagination || body;
    const total = Number(metadata.total), actualPage = Number(metadata.page), actualLimit = Number(metadata.limit);
    if (!Number.isSafeInteger(total) || total < 0 || actualPage !== page || actualLimit !== PAGE_SIZE || batch.length > PAGE_SIZE) throw reportError('The report source did not confirm its complete pagination. Refresh and retry.', 502, 'REPORT_PAGINATION_INVALID');
    assertRecordLimit(total);
    if (expectedTotal !== null && total !== expectedTotal) throw reportError('Records changed while the report was loading. Refresh and retry.', 409, 'REPORT_SOURCE_CHANGED');
    expectedTotal = total;
    for (const row of batch) {
      if (!row || typeof row !== 'object' || row.id === undefined || row.id === null || seen.has(String(row.id))) throw reportError('Records changed or repeated while the report was loading. Refresh and retry.', 409, 'REPORT_SOURCE_CHANGED');
      seen.add(String(row.id)); rows.push(row);
    }
    if (rows.length > total) throw reportError('The report source count does not agree with its records. Refresh and retry.', 409, 'REPORT_SOURCE_CHANGED');
    if (rows.length === total) return rows;
    if (batch.length < PAGE_SIZE) throw reportError('The report source omitted selected records. No partial document was downloaded.', 422, 'REPORT_SOURCE_INCOMPLETE');
  }
  throw reportError('The report could not include every selected record. Choose narrower filters.', 422, 'REPORT_SOURCE_INCOMPLETE');
}

function filterUnpaginated(definition, rows, query) {
  let result = rows;
  if (query.search) {
    const needle = query.search.toLowerCase();
    result = result.filter((row) => definition.columns.some(([, key]) => String(row[key] || '').toLowerCase().includes(needle)));
  }
  for (const field of ['department', 'role', 'category', 'country', 'status']) if (query[field]) result = result.filter((row) => String(row[field] || '').toLowerCase() === query[field].toLowerCase());
  if (query.active) {
    if (!['true', 'false', '1', '0'].includes(query.active)) throw reportError('Active staff must be true or false.');
    result = result.filter((row) => Boolean(Number(row.active)) === ['true', '1'].includes(query.active));
  }
  if (query.user_id) { const id = selectedUser(query.user_id); result = result.filter((row) => Number(row.user_id) === id); }
  const from = date(query.from_date, 'start'), to = date(query.to_date, 'end');
  if (from && to && from > to) throw reportError('The start date must precede the end date.');
  if (from || to) result = result.filter((row) => (!from || recordDate(row.shift_date) >= from) && (!to || recordDate(row.shift_date) <= to));
  if (query.sort || query.direction) {
    const direction = query.direction === 'desc' ? -1 : 1;
    const sort = query.sort || 'id';
    result = [...result].sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), 'en-AU', { numeric: true }) * direction || Number(a.id) - Number(b.id));
  }
  return result;
}

async function attendanceReport(req) {
  const query = requestQuery(req, null, true), params = [];
  const from = date(query.from_date || query.from, 'start'), to = date(query.to_date || query.to, 'end');
  if ((query.from_date && query.from && query.from_date !== query.from) || (query.to_date && query.to && query.to_date !== query.to)) throw reportError('Choose one consistent reporting period.');
  if (from && to && from > to) throw reportError('The start date must precede the end date.');
  const id = selectedUser(query.user_id);
  let where = 'WHERE IFNULL(a.deleted,0)=0';
  if (id) {
    if (!await canAccessUserRecord(req.user, id, { own: 'VIEW_OWN_TIMESHEET', team: 'VIEW_TEAM_TIMESHEET', all: 'VIEW_ALL_TIMESHEETS', connection: pool })) throw reportError('This staff timesheet is outside your permitted scope.', 403);
    where += ' AND a.user_id=?'; params.push(id);
  } else if (hasPermission(req.user, 'VIEW_ALL_TIMESHEETS')) {
    // Historical staff records remain visible to the original all-timesheets grant.
  } else if (hasPermission(req.user, 'VIEW_TEAM_TIMESHEET')) {
    where += ' AND ((u.manager_id=? AND u.active=1 AND u.deleted_at IS NULL)'; params.push(req.user.id);
    if (hasPermission(req.user, 'VIEW_OWN_TIMESHEET')) { where += ' OR a.user_id=?'; params.push(req.user.id); }
    where += ')';
  } else if (hasPermission(req.user, 'VIEW_OWN_TIMESHEET')) {
    where += ' AND a.user_id=?'; params.push(req.user.id);
  } else throw reportError('Timesheet reporting is not permitted for your account.', 403);
  if (from) { where += ' AND a.work_date>=?'; params.push(from); }
  if (to) { where += ' AND a.work_date<=?'; params.push(to); }
  const [rows] = await pool.query(`SELECT a.id,a.user_id,u.name,a.work_date,a.clock_in,a.clock_out,a.total_hours,a.total_minutes,a.timestamp_basis
    FROM staff_attendance a JOIN users u ON u.id=a.user_id ${where} ORDER BY a.work_date,a.clock_in,a.id LIMIT 10001`, params);
  assertRecordLimit(rows.length);
  const timezone = process.env.TIMESHEET_TIMEZONE || 'Australia/Sydney';
  try { new Intl.DateTimeFormat('en-AU', { timeZone: timezone }); } catch { throw reportError('The configured timesheet timezone requires correction before this report can be generated.', 422, 'REPORT_TIMEZONE_INVALID'); }
  return { title: 'Attendance and timesheet report', rows,
    columns: [['Staff', 'name', 2.2], ['Date', 'work_date', 1.4, 'date'], ['Clock in', 'clock_in', 2, 'datetime'], ['Clock out', 'clock_out', 2, 'datetime'], ['Hours', 'total_hours', 1, 'hours']],
    period: periodText(from, to, 'All authorised attendance records'), timezone,
    totals: [{ label: 'Recorded hours', value: sumHours(rows).toFixed(2) }], notes: [`Clock times: ${timezone}.`, 'UTC-attested work totals use consolidated recorded minutes; per-shift displayed hours are rounded.', 'Recorded attendance hours. Review and approval status must be confirmed in the application.'] };
}

function numeric(value, field) {
  const result = Number(value);
  if (!['number', 'string'].includes(typeof value) || !String(value).trim() || !Number.isFinite(result)) throw reportError(`The recorded ${field} value is invalid. Correct it before downloading this report.`, 422, 'REPORT_DATA_INVALID');
  return result;
}
function sumHours(rows) {
  let total = 0;
  for (const row of rows) {
    if (row.total_hours === null || row.total_hours === undefined) continue; // An open shift has no recorded duration yet.
    const value = numeric(row.total_hours, 'hours');
    if (value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw reportError('Recorded hours require correction before this report can be generated.', 422, 'REPORT_DATA_INVALID');
    total += Math.round(value * 100);
    if (!Number.isSafeInteger(total)) throw reportError('The recorded hours exceed the supported reporting amount.', 422, 'REPORT_DATA_INVALID');
  }
  try {return attendanceRecordedHours(rows);} catch(error){throw reportError(error.message,422,'REPORT_DATA_INVALID');}
}
function sumMoney(rows, field) {
  let cents = 0;
  for (const row of rows) {
    const value = numeric(row[field], field), next = Math.round(value * 100);
    if (!Number.isSafeInteger(next) || Math.abs(value * 100 - next) > 0.00001) throw reportError('Recorded amounts require correction before this report can be generated.', 422, 'REPORT_DATA_INVALID');
    cents += next;
    if (!Number.isSafeInteger(cents)) throw reportError('The report total exceeds the supported amount.', 422, 'REPORT_DATA_INVALID');
  }
  return cents / 100;
}
function formatCell(row, column, timezone) {
  const [, key, , format] = column, value = row[key];
  if (value === undefined || value === null || value === '') return format==='moneyReview'?'Requires review':'—';
  if (format === 'materialType') return value === 'packaging' ? 'Packaging' : value === 'raw_material' ? 'Raw material' : String(value);
  if(format==='moneyReview')return value===null||value===undefined?'Requires review':money(numeric(value,key),'AUD');
  if(format==='paymentState')return {review_required:'Payment details require review',paid:'Paid',partial:'Partially paid',unpaid:'Unpaid'}[value]||'Not recorded';
  if (format === 'money') return money(numeric(value, key), 'AUD');
  if (format === 'number' || format === 'hours') return numeric(value, key).toLocaleString('en-AU', { maximumFractionDigits: 3, ...(format === 'hours' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}) });
  if (format === 'time') {
    const text = String(value);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) throw reportError('A recorded roster time requires correction before downloading this report.', 422, 'REPORT_DATA_INVALID');
    return text.slice(0, 5);
  }
  if (format === 'date') {
    const text = date(recordDate(value), key);
    if (!text) throw reportError('A recorded report date requires correction.', 422, 'REPORT_DATA_INVALID');
    return dateLabel(text);
  }
  if (format === 'datetime') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw reportError('A recorded clock time requires correction before downloading this report.', 422, 'REPORT_DATA_INVALID');
    return parsed.toLocaleString('en-AU', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
  }
  return String(value);
}

exports.download = async (req, res, next) => {
  try {
    if (!req.user) throw reportError('Authentication required.', 401);
    const type = String(req.params.type || '');
    if (type === 'procurement') {
      const { download = '0', source: procurementSource = 'entries', ...filters } = req.query || {};
      if (!['0', '1'].includes(String(download))) throw reportError('Download must be 0 or 1.');
      const procurementReports = require('../services/procurementReportService');
      const snapshot = await procurementReports.createSnapshot({ user: req.user, input: { type: 'register', source: procurementSource, filters }, req });
      const saved = await procurementReports.getSnapshot({ user: req.user, snapshotId: snapshot.snapshot_id });
      return await sendPdfResponse(res, await procurementReports.snapshotArtifact(saved), String(download) === '1');
    }
    let source, query;
    if (type === 'timesheets') { query = requestQuery(req, null, true); source = await attendanceReport(req); }
    else {
      const definition = type === 'expenses' ? EXPENSE_REPORT : Object.hasOwn(REPORTS, type) ? REPORTS[type] : null;
      if (!definition) throw reportError('Report not found.', 404);
      const permissions = Array.isArray(definition.permission) ? definition.permission : [definition.permission];
      if (!permissions.every((permission) => hasPermission(req.user, permission))) throw reportError('This report is not permitted for your account.', 403);
      query = requestQuery(req, definition);
      const requestedFrom = date(query.from_date || query.from, 'start'), requestedTo = date(query.to_date || query.to, 'end');
      if (requestedFrom && requestedTo && requestedFrom > requestedTo) throw reportError('The start date must precede the end date.');
      if (type === 'roster' && query.status && !['scheduled', 'published', 'confirmed', 'completed', 'cancelled'].includes(query.status)) throw reportError('Choose a supported roster status.');
      let rows;
      if (type === 'materials') {
        const selected = query.type || query.inventory_type || 'all';
        if ((query.type && query.inventory_type && query.type !== query.inventory_type) || !['all', 'raw_material', 'packaging'].includes(selected)) throw reportError('Choose raw_material, packaging or all for this material report.');
        const types = selected === 'all' ? ['raw_material', 'packaging'] : [selected]; rows = [];
        const materialIds = new Set();
        for (const inventoryType of types) {
          const batch = await completeRegister(definition, req, { ...query, type: inventoryType, inventory_type: inventoryType });
          for (const row of batch) {
            if (row.inventory_type !== inventoryType || materialIds.has(String(row.id))) throw reportError('The material source did not confirm the selected inventory type. Refresh and retry.', 502, 'REPORT_SOURCE_INVALID');
            materialIds.add(String(row.id)); rows.push(row);
          }
        }
        if (query.sort) rows = filterUnpaginated({ ...definition, columns: [] }, rows, { sort: query.sort, direction: query.direction });
      } else {
        rows = await completeRegister(definition, req, query);
        if (!definition.paginated) rows = filterUnpaginated(definition, rows, query);
      }
      assertRecordLimit(rows.length);
      const from = date(query.from_date || query.from, 'start'), to = date(query.to_date || query.to, 'end');
      source = { title: definition.title, rows, columns: definition.columns,
        period: periodText(from, to, 'Current authorised records matching the selected filters'),
        totals: definition.total ? [{ label: definition.total[0], value: type==='invoices'&&rows.some(row=>row.total==null)?'Requires review':money(sumMoney(rows, definition.total[1]), 'AUD') },...(type==='invoices'?[...['paid_amount','balance_due'].map(field=>({label:field==='paid_amount'?'Paid amount':'Outstanding',value:rows.some(row=>row[field]==null)?'Requires review':money(sumMoney(rows,field),'AUD')})),{label:'Payment reviews',value:String(rows.filter(row=>row.payment_review_required).length)}]:[])] : [] };
    }
    const reference = type.toUpperCase() + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const artifact = await createDocumentPdf({ title: source.title, reference, issueDate: new Date(), period: source.period,
      columns: source.columns.map(([label, , width, format]) => ({ label, width, align: ['number', 'hours', 'money'].includes(format) ? 'right' : 'left' })),
      rows: source.rows.map((row) => source.columns.map((column) => formatCell(row, column, source.timezone))), totals: source.totals,
      notes: [`${source.rows.length} ${source.rows.length === 1 ? 'record' : 'records'}.`, ...(source.notes || [])] });
    return await sendPdfResponse(res, artifact, query.download === '1');
  } catch (error) { next(error); }
};
exports._test = { capture, date, attendanceReport, completeRegister, filterUnpaginated, formatCell, sumMoney, sumHours, REPORTS, EXPENSE_REPORT };
