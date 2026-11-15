'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../services/invoiceFolderService');
const admin = { id: 41, role: 'admin' };
const key = '4e'.repeat(32);

async function main() {
  const all = domain.selection({}, admin);
  assert.equal(all.page, 1); assert.equal(all.limit, 50);
  assert.equal(all.sort, 'id'); assert.equal(all.direction, 'DESC');
  assert.equal(all.where, ''); assert.deepEqual(all.params, []);
  const selected = domain.selection({ folder: key, page: '2', limit: '20', status: 'APPROVED', payment_state: 'unpaid', from: '2026-11-01', to: '2026-11-30', search: '50%_! Company' }, admin);
  assert.equal(selected.folder, key); assert.equal(selected.page, 2); assert.equal(selected.limit, 20);
  assert.deepEqual(selected.params, ['%50!%!_!! Company%', '%50!%!_!! Company%', '%50!%!_!! Company%', 'approved', 'unpaid', '2026-11-01', '2026-11-30', key]);
  assert.match(selected.where, /LIKE \? ESCAPE '!'/);
  assert(!selected.where.includes('50%'), 'search values must be bound rather than SQL text');
  assert.match(selected.where, /SHA2\(CASE .*OCTET_LENGTH.*\)=\?$/);

  for (const role of ['client', 'customer', 'viewer', 'view_only', 'Customer']) {
    const own = domain.selection({ folder: key }, { id: 42, role, email: '  STAFF.CLIENT@EXAMPLE.INVALID ' });
    assert.match(own.where, /^WHERE 1=0 AND SHA2\(/);
    assert.deepEqual(own.params, [key], 'the synchronous builder cannot accidentally skip unresolved JavaScript ownership');
    const empty = domain.selection({}, { id: 42, role, email: '' });
    assert.deepEqual(empty.params, []);
    assert.equal(empty.where, 'WHERE 1=0', 'a missing account email never matches even a malformed legacy sentinel mailbox');
  }
  const mailbox = value => ({ scope_email: Buffer.from(value), scope_value: value });
  const coarseCandidates = ['i@example.invalid', 'İ@example.invalid', 'i\u0307@example.invalid', 'ΟΣ@example.invalid', 'ος@example.invalid', 'οσ@example.invalid', 'ÅNGSTRÖM@example.invalid', 'angstrom@example.invalid'].map(mailbox);
  let candidateQueries = 0;
  const candidateDb = { async query(sql, params) {
    candidateQueries++;
    assert.match(sql, /^SELECT DISTINCT CAST\(customer_email AS BINARY\) AS scope_email,CONVERT\(customer_email USING utf8mb4\) AS scope_value FROM /);
    assert.match(sql, /COLLATE utf8mb4_unicode_ci.*LIMIT 1001$/);
    assert.equal(typeof params[0], 'string');
    return [coarseCandidates];
  } };
  for (const [email, expected] of [
    ['i@example.invalid', ['i@example.invalid']],
    ['i\u0307@example.invalid', ['İ@example.invalid', 'i\u0307@example.invalid']],
    ['ος@example.invalid', ['ΟΣ@example.invalid', 'ος@example.invalid']],
    ['οσ@example.invalid', ['οσ@example.invalid']],
    [' ångström@example.invalid ', ['ÅNGSTRÖM@example.invalid']],
    ['angstrom@example.invalid', ['angstrom@example.invalid']]
  ]) {
    const scoped = await domain.scopedSelection(candidateDb, { folder: key }, { id: 42, role: 'client', email });
    assert.match(scoped.where, /^WHERE CAST\(customer_email AS BINARY\) IN \(\?(?:,\?)*\) AND SHA2\(/);
    assert.deepEqual(scoped.params.slice(0, -1).map(value => value.toString()), expected, 'only exact JavaScript ownership may reach rows, counts or folder aggregates');
    assert.equal(scoped.params.at(-1), key);
    assert(!scoped.where.includes('@example.invalid'), 'raw allowed bytes are bound, never interpolated into SQL');
  }
  const beforeEmpty = candidateQueries;
  const noAccount = await domain.scopedSelection(candidateDb, {}, { id: 42, role: 'client', email: '' });
  assert.equal(noAccount.where, 'WHERE 1=0'); assert.deepEqual(noAccount.params, []); assert.equal(candidateQueries, beforeEmpty);
  const noMatch = await domain.scopedSelection(candidateDb, { folder: key }, { id: 42, role: 'client', email: 'another@example.invalid' });
  assert.match(noMatch.where, /^WHERE 1=0 AND SHA2\(/); assert.deepEqual(noMatch.params, [key]);
  await assert.rejects(domain.scopedSelection({ query: async () => [Array.from({ length: 1001 }, () => mailbox('i@example.invalid'))] }, {}, { role: 'client', email: 'i@example.invalid' }), error => error.status === 422 && error.code === 'INVOICE_SCOPE_REVIEW_REQUIRED');
  const rawLatin1 = Buffer.from([0xc5, ...Buffer.from('NGSTR\xd6M@example.invalid', 'latin1')]);
  const legacy = await domain.scopedSelection({ query: async () => [[{ scope_email: rawLatin1, scope_value: 'ÅNGSTRÖM@example.invalid' }]] }, {}, { role: 'client', email: 'ångström@example.invalid' });
  assert.deepEqual(legacy.params, [rawLatin1], 'retain the actual stored bytes separately from decoded UTF-8 identity');
  await assert.rejects(domain.scopedSelection({ query: async () => [[{ scope_email: 'incorrectly decoded raw bytes', scope_value: 'i@example.invalid' }]] }, {}, { role: 'client', email: 'i@example.invalid' }), error => error.code === 'INVOICE_SCOPE_REVIEW_REQUIRED');
  for (const query of [
    { folder: '../other-company' }, { folder: 'a'.repeat(63) }, { folder: ['a'.repeat(64)] }, { folder: { key } },
    { folder: '' }, { folder: '   ' }, { folder: key.toUpperCase() }, { folder: ' ' + key }, { folder: null }, { folder: undefined },
    { search: 'a'.repeat(121) }, { search: ['company'] }, { search: '\ncompany' }, { search: {} },
    { page: '1tail' }, { page: '0' }, { page: '-1' }, { page: '9007199254740992' }, { limit: '101' },
    { limit: ['1'] }, { archived: 'yes' }, { from: '2026-02-30' }, { to: '2026-11-01T00:00:00' },
    { from: '2026-11-30', to: '2026-11-01' }, { sort: 'total; DROP TABLE invoices' }, { direction: 'desc;--' }
  ]) assert.throws(() => domain.selection(query, admin), error => error.status === 422 && error.code === 'INVOICE_FILTER_INVALID' && Object.keys(error.errors).length === 1);
  assert.throws(() => domain.selection({ archived: 'true' }, { id: 43, role: 'client', email: 'client@example.invalid' }), error => error.status === 403);
  assert.equal(domain.selection({ archived: 'true' }, admin).archived, true);
  assert.throws(() => domain.folderKeySql('i;DROP'), /Invalid invoice folder SQL alias/);
  const identitySql = domain.folderKeySql('i');
  assert.match(identitySql, /invoice-folder-v1:unassigned:',i\.id/);
  assert.match(identitySql, /invoice-folder-v1:identity:/);
  assert.match(identitySql, /OCTET_LENGTH\(LOWER\(TRIM\(\(CONVERT\(COALESCE\(i\.customer_name/);
  assert.match(identitySql, /OCTET_LENGTH\(LOWER\(TRIM\(\(CONVERT\(COALESCE\(i\.customer_email/);
  assert.match(identitySql, /USING utf8mb4\) COLLATE utf8mb4_bin/);
  assert(!/customer_id|customers\b/.test(identitySql), 'do not invent invoice/customer links or rewrite historical identity');

  const queries = [];
  let groupQueries = 0;
  const rows = [{ folder_key: key, name: 'Fixture Company', email: 'accounts@example.invalid', invoice_count: '37', latest_invoice_at: '2026-11-13', total_value: '3700.00', paid_value: '1200.00', balance_value: '2500.00', missing_total: 0, missing_paid: 0, missing_balance: 0, unassigned: 0 }];
  const db = { async query(sql, params) {
    assert.match(sql, /^SELECT\b/, 'folder browsing performs no database writes');
    queries.push({ sql, params });
    if (sql.startsWith('SELECT DISTINCT CAST(customer_email AS BINARY)')) return [[mailbox('accounts@example.invalid'), mailbox('unrelated@example.invalid')]];
    return ++groupQueries % 2 ? [[{ total: '13', invoice_total: '49' }]] : [rows];
  } };
  const query = { page: '2', limit: '1', company_search: '50%_! Company', search: 'INV-1', status: 'approved', sort: 'invoice_count', direction: 'desc' };
  const user = { id: 44, role: 'client', email: 'ACCOUNTS@example.invalid' };
  const result = await domain.listFolders(db, query, user);
  assert.equal(result.total, 13); assert.equal(result.pages, 13); assert.equal(result.invoice_total, 49);
  assert.equal(result.page, 2); assert.equal(result.limit, 1);
  assert.equal(result.folders.length, 1); assert.equal(result.folders[0].invoice_count, 37, 'a folder count covers all matching invoices, independent of folder page size');
  assert.equal(result.folders[0].total_value, 3700); assert.equal(result.folders[0].balance_value, 2500);
  assert.equal(result.folders[0].key, key); assert.equal(result.folders[0].currency, 'AUD');
  assert.equal(result.folders[0].missing_email, false); assert.equal(result.folders[0].unassigned, false);
  assert(!JSON.stringify(result).includes('missing_paid'), 'internal aggregation counters are not exposed as document/status metadata');
  const groupedQueries = queries.filter(item => item.sql.includes(') company_folders'));
  assert.equal(groupedQueries.length, 2);
  assert.equal(queries.length, 3, 'the coarse candidate lookup is distinct from authoritative count/row aggregates');
  assert.deepEqual(queries[0].params, ['accounts@example.invalid', '%INV-1%', '%INV-1%', '%INV-1%', 'approved']);
  for (const item of groupedQueries) {
    assert.match(item.sql, /WHERE CAST\(customer_email AS BINARY\) IN \(\?\) AND .* GROUP BY folder_key\) company_folders WHERE \(LOWER\(name\) LIKE \? ESCAPE '!' OR LOWER\(email\) LIKE \? ESCAPE '!'\)/);
    assert.deepEqual(item.params.slice(0, 7), [Buffer.from('accounts@example.invalid'), '%INV-1%', '%INV-1%', '%INV-1%', 'approved', '%50!%!_!! company%', '%50!%!_!! company%']);
    const inner = item.sql.split(') company_folders')[0];
    assert(!/\bLIMIT\b/.test(inner), 'grouping must not truncate matching invoice rows to the current list page');
  }
  assert.deepEqual(groupedQueries[1].params.slice(-2), [1, 1]);
  assert.match(groupedQueries[1].sql, /ORDER BY invoice_count DESC,folder_key DESC LIMIT \? OFFSET \?$/);
  rows[0].missing_paid = 1; rows[0].missing_balance = 1;
  const review = await domain.listFolders(db, { folder: key }, admin);
  assert.equal(review.folders[0].total_value, 3700);
  assert.equal(review.folders[0].paid_value, null); assert.equal(review.folders[0].balance_value, null, 'an unverified payment is never presented as zero/outstanding certainty');
  rows[0].email = 'ΟΣ@example.invalid';
  assert.equal((await domain.listFolders(db, {}, admin)).folders[0].email, 'ος@example.invalid', 'display uses the same contextual Unicode normalisation as account ownership');
  rows[0].email = 'İ@example.invalid';
  assert.equal((await domain.listFolders(db, {}, admin)).folders[0].email, 'i\u0307@example.invalid', 'display must not invent an ASCII mailbox from Turkish capital I');
  assert.deepEqual(domain.summaryFor(0, {}), { total_value: 0, paid_value: 0, balance_value: 0 });
  for (const company_search of ['a'.repeat(121), ['company'], { value: 'company' }]) await assert.rejects(domain.listFolders(db, { company_search }, admin), error => error.status === 422 && Boolean(error.errors.company_search));
  const routes = fs.readFileSync(path.join(__dirname, '../routes/invoiceRoutes.js'), 'utf8');
  assert(routes.indexOf("router.get('/folders'") < routes.indexOf("router.get('/:id'"), 'literal folder route must precede invoice ID handling');
  console.log('Invoice folders passed: bound literal filters, strict selector/paging/date validation, scope-before-group ownership, full-selection counts and null-safe totals, opaque length-prefixed identity SQL, per-invoice unassigned fallback and no database/file writes. Real grouping/collision/archive persistence is separately covered by the MySQL fixture.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
