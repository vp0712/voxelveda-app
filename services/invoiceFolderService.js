'use strict';

const { customerScoped, customerEmail, ownsCustomerRecord } = require('./customerRecordScope');
const { hasPermission } = require('./authorizationService');
const { dateOnly } = require('../utils/dateOnly');
const invoiceSummary = require('./invoiceSummaryService');

const invoiceSorts = Object.freeze({ date: 'created_at', customer: 'customer_name', total: 'total', balance: 'balance_due', reference: 'invoice_no', status: 'status', id: 'id' });
const folderSorts = Object.freeze({ date: 'latest_invoice_at', customer: 'name', total: 'total_value', balance: 'balance_value', reference: 'name', status: 'name', invoice_count: 'invoice_count', id: 'folder_key' });

function invalid(field, message) {
  return Object.assign(new Error(message), { status: 422, code: 'INVOICE_FILTER_INVALID', errors: { [field]: message } });
}
function text(query, field, maximum) {
  const value = query[field];
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(field, `Enter ${field === 'company_search' ? 'a company search' : field === 'search' ? 'a search' : field} of up to ${maximum} characters.`);
  return value.trim();
}
function positiveInteger(value, fallback, field, maximum) {
  if (value === undefined || value === '') return fallback;
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) throw invalid(field, `Enter a valid ${field}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw invalid(field, `Enter ${field} from 1 to ${maximum}.`);
  return number;
}
function escapeLike(value) { return value.replace(/[!%_]/g, character => '!' + character); }
// Historical invoice text columns may have different inherited collations.
// Convert expression values, never the stored columns/schema, before combining
// identity/display branches in CONCAT, CASE, MIN or COALESCE.
function utf8Value(expression) { return `(CONVERT(${expression} USING utf8mb4) COLLATE utf8mb4_bin)`; }
function normalizedColumn(column, alias) { return `LOWER(TRIM(${utf8Value(`COALESCE(${alias ? alias + '.' : ''}${column},'')`)}))`; }

// Invoice history contains customer name/email snapshots, not an authoritative
// customer ID. Keep different mailboxes separate even when names are identical.
// Length-prefixed UTF-8 prevents separator collisions. Unassigned records have
// individual folders; these hashes identify views, never confer authorisation.
function folderKeySql(alias = '') {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid invoice folder SQL alias.');
  const name = normalizedColumn('customer_name', alias), email = normalizedColumn('customer_email', alias);
  const id = `${alias ? alias + '.' : ''}id`;
  return `SHA2(CASE WHEN ${name}='' AND ${email}='' THEN CONCAT('invoice-folder-v1:unassigned:',${id}) ELSE CONCAT('invoice-folder-v1:identity:',OCTET_LENGTH(${name}),':',${name},':',OCTET_LENGTH(${email}),':',${email}) END,256)`;
}

function selection(query = {}, user, { folders = false, deferCustomerScope = false } = {}) {
  const page = positiveInteger(query.page, 1, 'page', 2147483647), limit = positiveInteger(query.limit, 50, 'limit', 100);
  if (!Number.isSafeInteger((page - 1) * limit)) throw invalid('page', 'Choose a supported invoice page.');
  const archive = text(query, 'archived', 5);
  if (!['', 'true', 'false'].includes(archive)) throw invalid('archived', 'Choose active or archived invoices.');
  const archived = archive === 'true';
  if (archived && !hasPermission(user, 'VOID_TRANSACTION')) throw Object.assign(new Error('Archived invoice access is not permitted.'), { status: 403 });
  const conditions = [], params = [];
  // The synchronous builder cannot reproduce JavaScript's Unicode ownership
  // rules inside MySQL. It is deliberately closed until scopedSelection has
  // resolved and checked the raw mailbox candidates below.
  if (customerScoped(user) && !deferCustomerScope) conditions.push('1=0');
  const search = text(query, 'search', 120);
  if (search) {
    conditions.push("(invoice_no LIKE ? ESCAPE '!' OR customer_name LIKE ? ESCAPE '!' OR customer_email LIKE ? ESCAPE '!')");
    params.push(...Array(3).fill(`%${escapeLike(search)}%`));
  }
  const status = text(query, 'status', 40).toLowerCase();
  if (status) { conditions.push('status=?'); params.push(status); }
  const paymentState = text(query, 'payment_state', 40);
  if (paymentState) { conditions.push('payment_state=?'); params.push(paymentState); }
  const from = text(query, 'from', 10), to = text(query, 'to', 10);
  if (from) { if (dateOnly(from) !== from) throw invalid('from', 'Enter a valid start date.'); conditions.push('DATE(created_at)>=?'); params.push(from); }
  if (to) { if (dateOnly(to) !== to) throw invalid('to', 'Enter a valid end date.'); conditions.push('DATE(created_at)<=?'); params.push(to); }
  if (from && to && from > to) throw invalid('to', 'Choose an end date on or after the start date.');
  // A supplied but malformed selector must never fall back to all invoices.
  // Clear a folder by omitting the parameter, not by supplying an empty value.
  const folder = Object.hasOwn(query, 'folder') ? query.folder : '';
  if (Object.hasOwn(query, 'folder') && (typeof folder !== 'string' || !/^[a-f0-9]{64}$/.test(folder))) throw invalid('folder', 'Choose a valid company folder.');
  if (folder) { conditions.push(`${folderKeySql()}=?`); params.push(folder); }
  const sorts = folders ? folderSorts : invoiceSorts;
  const requestedSort = text(query, 'sort', 40) || (folders ? 'customer' : 'id');
  if (!Object.hasOwn(sorts, requestedSort)) throw invalid('sort', 'Choose a supported sort field.');
  const direction = (text(query, 'direction', 4) || (folders ? 'asc' : 'desc')).toUpperCase();
  if (!['ASC', 'DESC'].includes(direction)) throw invalid('direction', 'Choose ascending or descending sort order.');
  return { page, limit, archived, folder, where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params, sort: sorts[requestedSort], direction };
}

function withScope(options, predicate, params = []) {
  return { ...options, where: `WHERE ${predicate}${options.where ? ' AND ' + options.where.slice('WHERE '.length) : ''}`, params: [...params, ...options.params] };
}
function scopeReview() {
  return Object.assign(new Error('This customer invoice selection requires an authorised scope review. Narrow the date or search filters and retry.'), {
    status: 422, code: 'INVOICE_SCOPE_REVIEW_REQUIRED', errors: { search: 'Narrow the invoice search or reporting dates before retrying.' }
  });
}
async function scopedSelection(db, query, user, { folders = false } = {}) {
  const options = selection(query || {}, user, { folders, deferCustomerScope: true });
  if (!customerScoped(user)) return options;
  const email = customerEmail(user);
  if (!email) return withScope(options, '1=0');
  // Case/accent-insensitive SQL is only a bounded candidate lookup. Its result
  // is never returned or used for counts. JavaScript ownsCustomerRecord is the
  // authority: MySQL LOWER differs for Turkish I and contextual Greek sigma.
  const coarse = withScope(options, '(CONVERT(TRIM(customer_email) USING utf8mb4) COLLATE utf8mb4_unicode_ci)=(CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci)', [email]);
  const select = invoiceSummary.receivableSelect(options.archived ? 'WHERE i.deleted=1' : undefined);
  const [candidates] = await db.query(`SELECT DISTINCT CAST(customer_email AS BINARY) AS scope_email,CONVERT(customer_email USING utf8mb4) AS scope_value FROM (${select}) records ${coarse.where} LIMIT 1001`, coarse.params);
  if (candidates.length > 1000) throw scopeReview();
  const allowed = new Map();
  for (const candidate of candidates) {
    const value = candidate.scope_value;
    if (typeof value !== 'string' || !ownsCustomerRecord(user, value)) continue;
    const raw = candidate.scope_email;
    if (!Buffer.isBuffer(raw)) throw scopeReview();
    allowed.set(raw.toString('hex'), raw);
  }
  if (!allowed.size) return withScope(options, '1=0');
  const values = [...allowed.values()];
  return withScope(options, `CAST(customer_email AS BINARY) IN (${values.map(() => '?').join(',')})`, values);
}

const totalsSql = 'SUM(total) total_value,SUM(paid_amount) paid_value,SUM(balance_due) balance_value,SUM(total IS NULL) missing_total,SUM(paid_amount IS NULL) missing_paid,SUM(balance_due IS NULL) missing_balance';
function summaryFor(count, totals) {
  const result = {};
  for (const [field, missing] of [['total_value', 'missing_total'], ['paid_value', 'missing_paid'], ['balance_value', 'missing_balance']]) {
    const amount = Number(totals[field]);
    result[field] = Number(count) === 0 ? 0 : Number(totals[missing]) > 0 || totals[field] == null || !Number.isFinite(amount) ? null : amount;
  }
  return result;
}
async function listFolders(db, query, user) {
  query = query || {};
  const options = await scopedSelection(db, query, user, { folders: true });
  const select = invoiceSummary.receivableSelect(options.archived ? 'WHERE i.deleted=1' : undefined);
  const unassigned = `${normalizedColumn('customer_name', '')}='' AND ${normalizedColumn('customer_email', '')}=''`;
  const displayName = `MIN(NULLIF(TRIM(${utf8Value('customer_name')}),''))`;
  const displayEmail = `MIN(NULLIF(TRIM(${utf8Value('customer_email')}),''))`;
  const reference = `MIN(COALESCE(NULLIF(TRIM(${utf8Value('invoice_no')}),''),${utf8Value('CAST(id AS CHAR)')}))`;
  const grouped = `SELECT ${folderKeySql()} AS folder_key,COALESCE(${displayName},${displayEmail},CONCAT('Unassigned invoice ',${reference})) AS name,COALESCE(${displayEmail},'') AS email,MAX(CASE WHEN ${unassigned} THEN 1 ELSE 0 END) AS unassigned,COUNT(*) AS invoice_count,MAX(created_at) AS latest_invoice_at,${totalsSql} FROM (${select}) records ${options.where} GROUP BY folder_key`;
  const companySearch = text(query, 'company_search', 120);
  const companyWhere = companySearch ? "WHERE (LOWER(name) LIKE ? ESCAPE '!' OR LOWER(email) LIKE ? ESCAPE '!')" : '';
  const params = [...options.params, ...(companySearch ? Array(2).fill(`%${escapeLike(companySearch.toLowerCase())}%`) : [])];
  const [[count]] = await db.query(`SELECT COUNT(*) total,COALESCE(SUM(invoice_count),0) invoice_total FROM (${grouped}) company_folders ${companyWhere}`, params);
  const [rows] = await db.query(`SELECT * FROM (${grouped}) company_folders ${companyWhere} ORDER BY ${options.sort} ${options.direction},folder_key ${options.direction} LIMIT ? OFFSET ?`, [...params, options.limit, (options.page - 1) * options.limit]);
  return { folders: rows.map(row => ({ key: row.folder_key, name: row.name, email: String(row.email || '').trim().toLowerCase(), invoice_count: Number(row.invoice_count), latest_invoice_at: row.latest_invoice_at, currency: 'AUD', ...summaryFor(row.invoice_count, row), missing_email: !String(row.email || '').trim(), unassigned: Number(row.unassigned) === 1 })), total: Number(count.total), page: options.page, limit: options.limit, pages: Math.ceil(Number(count.total) / options.limit), invoice_total: Number(count.invoice_total) };
}

module.exports = { folderKeySql, selection, scopedSelection, listFolders, totalsSql, summaryFor, escapeLike };
