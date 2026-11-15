'use strict';

// Run only inside the fresh, guarded retained-MySQL regression database.
// These are synthetic business records; this fixture never uses a real inbox.
module.exports = async function invoiceFolderMysqlFixture({ pool, assert, facts, response }) {
  if (process.env.NODE_ENV !== 'test' || process.env.REPAIR_DB_TEST !== 'true') {
    throw new Error('Invoice folder SQL fixtures require the guarded disposable test database.');
  }
  const [[identity]] = await pool.query('SELECT DATABASE() AS name');
  assert.equal(identity.name, 'voxelveda_repair_test', 'Never run invoice folder fixtures against another database.');

  const crypto = require('node:crypto');
  const controller = require('../controllers/invoiceController');
  assert.equal(typeof controller.getInvoiceFolders, 'function', 'Exercise the actual company-folder controller.');
  const admin = { id: 20, role: 'admin' };
  const prefix = 'IFOLDER-SQL-';
  const email = 'invoice-folder-main@example.invalid';
  const company = 'Folder Fixture Main Company';
  const rows = [];
  function fixture(name, recipient, options = {}) {
    const number = rows.length + 1;
    const row = {
      id: 880000 + number,
      invoice_no: prefix + String(number).padStart(3, '0'),
      customer_name: name,
      customer_email: recipient,
      total: 110,
      status: 'approved',
      created_at: '2026-11-05 12:00:00',
      ...options
    };
    rows.push(row);
    return row;
  }
  const main = Array.from({ length: 37 }, () => fixture(company, email));
  main.push(fixture('  folder fixture main company  ', '  INVOICE-FOLDER-MAIN@EXAMPLE.INVALID  '));
  main.push(fixture('FOLDER FIXTURE MAIN COMPANY', email, { status: 'paid' }));
  const otherEmail = [fixture(company, 'invoice-folder-other@example.invalid'), fixture(company, 'invoice-folder-other@example.invalid')];
  const noEmail = [fixture('Folder Fixture No Email', null), fixture(' folder fixture no email ', '')];
  const unassigned = [fixture(null, null), fixture('', '')];
  const noName = [fixture(null, 'invoice-folder-nameless@example.invalid'), fixture('', ' INVOICE-FOLDER-NAMELESS@EXAMPLE.INVALID ')];
  const literal = fixture('IFOLDER%_SQL Parts', 'invoice-folder-literal@example.invalid');
  for (let index = 1; index <= 9; index++) fixture('Folder Fixture Separate ' + index, 'invoice-folder-' + index + '@example.invalid');
  assert.equal(rows.length, 57);
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [[collision]] = await pool.query(`SELECT COUNT(*) count FROM invoices WHERE id IN (${placeholders})`, ids);
  assert.equal(Number(collision.count), 0, 'Fixture IDs must not overwrite other retained records.');
  for (const row of rows) {
    await pool.query(`INSERT INTO invoices
      (id,invoice_no,customer_name,customer_email,description,quantity,unit_price,gst_rate,total,status,deleted,document_revision,created_at)
      VALUES(?,?,?,?,?,1,100,10,?,?,0,1,?)`,
    [row.id, row.invoice_no, row.customer_name, row.customer_email, 'Synthetic company-folder source invoice', row.total, row.status, row.created_at]);
  }
  await pool.query(`INSERT INTO invoice_payments(invoice_id,amount,payment_date,method,reference,created_by)
    VALUES(?,10,'2026-11-05','Synthetic fixture receipt','IFOLDER-REAL-PAYMENT',20)`, [main[0].id]);

  const request = (query = {}, user = admin) => ({ query, user });
  async function get(method, query = {}, user = admin) {
    const res = response();
    await controller[method](request(query, user), res);
    return res;
  }
  async function folders(query = {}, user = admin) {
    const res = await get('getInvoiceFolders', { search: prefix, ...query }, user);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert(Array.isArray(res.body.folders));
    return res.body;
  }
  async function invoices(query = {}, user = admin) {
    const res = await get('getInvoices', { search: prefix, ...query }, user);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert(Array.isArray(res.body.invoices));
    return res.body;
  }
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function readState() {
    const invoices = (await pool.query(`SELECT * FROM invoices WHERE id IN (${placeholders}) ORDER BY id`, ids))[0];
    const payments = (await pool.query(`SELECT * FROM invoice_payments WHERE invoice_id IN (${placeholders}) ORDER BY id`, ids))[0];
    const activities = (await pool.query(`SELECT * FROM invoice_activity WHERE invoice_id IN (${placeholders}) ORDER BY id`, ids))[0];
    const [[audit]] = await pool.query('SELECT COUNT(*) count FROM audit_logs');
    const [[queued]] = await pool.query('SELECT COUNT(*) count FROM email_queue');
    const tables = (await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name'))[0];
    return digest({ invoices, payments, activities, audit, queued, tables });
  }

  const untouchedBefore = await readState();
  const index = await folders({ page: '1', limit: '100' });
  assert.equal(index.invoice_total, 57, 'Folder totals include the entire authorised selection, not the first invoice page.');
  assert.equal(index.total, 16, 'Separate emails, unknown identities and missing fields preserve distinct safe buckets.');
  const primary = index.folders.find(folder => String(folder.email || '').trim().toLowerCase() === email);
  const secondary = index.folders.find(folder => String(folder.email || '').trim().toLowerCase() === otherEmail[0].customer_email);
  assert(primary && secondary);
  assert.match(primary.key, /^[a-f0-9]{64}$/);
  assert.notEqual(primary.key, secondary.key, 'A common company label does not combine different contact identities.');
  assert.equal(primary.invoice_count, 39);
  assert.equal(secondary.invoice_count, 2);
  assert.equal(primary.total_value, 4290);
  assert.equal(primary.paid_value, null, 'An unsupported historical paid claim must not become a fabricated zero.');
  assert.equal(primary.balance_value, null);
  assert.equal(index.folders.find(folder => String(folder.name || '').trim().toLowerCase() === 'folder fixture no email').invoice_count, noEmail.length);
  assert.equal(index.folders.find(folder => String(folder.email || '').trim().toLowerCase() === 'invoice-folder-nameless@example.invalid').invoice_count, noName.length);
  assert.equal(index.folders.filter(folder => !folder.email && folder.invoice_count === 1).length, 2, 'Completely unidentified invoices remain per-record folders.');

  const keys = [];
  for (let page = 1; page <= 6; page++) {
    const part = await folders({ page: String(page), limit: '3' });
    assert.equal(part.total, 16);
    assert.equal(part.invoice_total, 57);
    assert(part.folders.length <= 3);
    keys.push(...part.folders.map(folder => folder.key));
  }
  assert.equal(keys.length, 16);
  assert.equal(new Set(keys).size, 16, 'Folder pagination is deterministic and contains no repeated or lost folder.');
  assert.deepEqual([...keys].sort(), index.folders.map(folder => folder.key).sort());

  const selectedIds = [];
  for (let page = 1; page <= 3; page++) {
    const part = await invoices({ folder: primary.key, page: String(page), limit: '13', sort: 'reference', direction: 'asc' });
    assert.equal(part.total, 39);
    assert.equal(part.summary.total_value, 4290);
    assert.equal(part.summary.paid_value, null);
    assert.equal(part.summary.balance_value, null);
    assert(part.invoices.every(row => main.some(source => source.id === Number(row.id))));
    selectedIds.push(...part.invoices.map(row => Number(row.id)));
  }
  assert.deepEqual(selectedIds.sort((a, b) => a - b), main.map(row => row.id).sort((a, b) => a - b));
  const paidOnly = await folders({ status: 'paid' });
  assert.equal(paidOnly.invoice_total, 1);
  assert.equal(paidOnly.folders.length, 1);
  assert.equal(paidOnly.folders[0].key, primary.key, 'Keys do not depend on current filters or counts.');
  assert.equal((await invoices({ folder: primary.key, status: 'paid' })).total, 1);
  assert.equal((await invoices({ folder: primary.key, from: '2026-11-06' })).total, 0);
  assert.equal((await folders({ from: '2026-11-06' })).total, 0);
  const literalOnly = await folders({ search: 'IFOLDER%_SQL' });
  assert.equal(literalOnly.invoice_total, 1, 'Search treats SQL wildcard characters as literal user text.');
  assert.equal((await invoices({ folder: literalOnly.folders[0].key, search: 'IFOLDER%_SQL' })).invoices[0].id, literal.id);
  const literalCompany = await folders({ company_search: 'IFOLDER%_SQL' });
  assert.equal(literalCompany.total, 1);
  assert.equal(literalCompany.invoice_total, 1);
  assert.equal(literalCompany.folders[0].key, literalOnly.folders[0].key, 'Folder search uses a literal company identity match.');
  assert.equal((await folders({ search: 'IFOLDER-SQL-001', company_search: 'IFOLDER%_SQL' })).total, 0,
    'Company search intersects the invoice selection; it cannot broaden the current register.');
  const exactFolder = await folders({ folder: primary.key });
  assert.equal(exactFolder.total, 1);
  assert.equal(exactFolder.invoice_total, main.length);
  assert.equal(exactFolder.folders[0].key, primary.key);
  assert.equal(exactFolder.folders[0].email, email);

  for (const role of ['client', 'customer', 'viewer', 'view_only']) {
    const customer = { id: 21, role, email: ' INVOICE-FOLDER-MAIN@EXAMPLE.INVALID ', permissions: ['VIEW_FINANCE'] };
    const visible = await folders({}, customer);
    assert.equal(visible.total, 1);
    assert.equal(visible.invoice_total, main.length);
    assert.equal(visible.folders[0].key, primary.key);
    assert.equal((await invoices({ folder: secondary.key }, customer)).total, 0, 'An opaque foreign key never broadens customer access.');
    assert.equal((await invoices({ folder: primary.key, limit: '100' }, customer)).invoices.length, main.length);
    assert.equal((await get('getInvoiceFolders', { archived: 'true' }, customer)).statusCode, 403);
  }
  const noRecipient = { id: 21, role: 'client', email: '', permissions: ['VIEW_FINANCE'] };
  assert.equal((await folders({}, noRecipient)).invoice_total, 0, 'A missing account email cannot acquire unnamed or missing-email invoices.');
  const unknown = await invoices({ folder: 'f'.repeat(64) });
  assert.equal(unknown.total, 0, 'A valid unknown key must never fall back to the broad register.');
  for (const method of ['getInvoices', 'getInvoiceFolders']) {
    for (const value of ['', ' ', null, undefined, 'A'.repeat(64), 'not-a-folder', 'a'.repeat(63), 'a'.repeat(65), ['a'.repeat(64)]]) {
      const invalid = await get(method, { folder: value });
      assert.equal(invalid.statusCode, 422, JSON.stringify(invalid.body));
    }
  }
  for (const value of ['x'.repeat(121), ['literal company'], { search: 'company' }]) {
    const invalid = await get('getInvoiceFolders', { company_search: value });
    assert.equal(invalid.statusCode, 422, JSON.stringify(invalid.body));
  }
  assert.equal(await readState(), untouchedBefore, 'Folder/index/filter/paging reads preserve all source rows, payment/audit/queue history and schema.');

  // A delimiter-only key would alias these distinct identities; UTF-8 length
  // and Unicode case handling must be exercised by MySQL, not a copied JS hash.
  const identityRows = [
    [880101, 'a:b', 'c@example.invalid'],
    [880102, 'a', 'b:c@example.invalid'],
    [880103, 'Ångström 精密 Parts', 'unicode-folders@example.invalid'],
    [880104, ' ångström 精密 parts ', ' UNICODE-FOLDERS@EXAMPLE.INVALID '],
    [880105, 'Angstrom 精密 Parts', 'unicode-folders@example.invalid']
  ];
  for (const [id, name, recipient] of identityRows) await pool.query(`INSERT INTO invoices
    (id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision)
    VALUES(?,?,?,?,1,100,10,110,'draft',0,1)`, [id, 'IFOLDER-IDENTITY-' + id, name, recipient]);
  const identities = await folders({ search: 'IFOLDER-IDENTITY-' });
  assert.equal(identities.invoice_total, 5);
  assert.equal(identities.total, 4, 'Delimiter-like text cannot alias another identity and accents are not erased.');
  assert.equal(new Set(identities.folders.map(folder => folder.key)).size, 4);
  const unicode = identities.folders.filter(folder => folder.email === 'unicode-folders@example.invalid');
  assert.deepEqual(unicode.map(folder => folder.invoice_count).sort((a, b) => a - b), [1, 2]);
  const unicodePair = unicode.find(folder => folder.invoice_count === 2);
  assert.deepEqual((await invoices({ search: 'IFOLDER-IDENTITY-', folder: unicodePair.key })).invoices.map(row => Number(row.id)).sort(), [880103, 880104]);

  // The default MySQL accent-insensitive collation is not mailbox ownership.
  // Distinct normalised mailbox bytes remain separate before rows/counts group.
  const mailboxRows = [
    [880106, 'ångstrom-email@example.invalid'],
    [880107, 'angstrom-email@example.invalid']
  ];
  for (const [id, recipient] of mailboxRows) await pool.query(`INSERT INTO invoices
    (id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision)
    VALUES(?,?,'Folder Fixture Mailbox Identity',?,1,100,10,110,'draft',0,1)`, [id, 'IFOLDER-EMAILIDENTITY-' + id, recipient]);
  const mailboxIndex = await folders({ search: 'IFOLDER-EMAILIDENTITY-' });
  assert.equal(mailboxIndex.total, 2);
  assert.equal(mailboxIndex.invoice_total, 2);
  const accentedKey = mailboxIndex.folders.find(folder => folder.email === mailboxRows[0][1]).key;
  const asciiKey = mailboxIndex.folders.find(folder => folder.email === mailboxRows[1][1]).key;
  assert.notEqual(accentedKey, asciiKey);
  for (const [id, recipient] of mailboxRows) {
    const client = { id: 21, role: 'client', email: recipient, permissions: ['VIEW_FINANCE'] };
    const scoped = await folders({ search: 'IFOLDER-EMAILIDENTITY-' }, client);
    assert.equal(scoped.total, 1, 'Accent-insensitive SQL comparisons must not expose another mailbox folder.');
    assert.equal(scoped.invoice_total, 1);
    assert.equal(scoped.folders[0].email, recipient);
    const scopedRows = await invoices({ search: 'IFOLDER-EMAILIDENTITY-', limit: '100' }, client);
    assert.deepEqual(scopedRows.invoices.map(row => Number(row.id)), [id]);
    const foreign = recipient === mailboxRows[0][1] ? asciiKey : accentedKey;
    assert.equal((await invoices({ search: 'IFOLDER-EMAILIDENTITY-', folder: foreign }, client)).total, 0);
    assert.equal((await folders({ search: 'IFOLDER-EMAILIDENTITY-', folder: foreign }, client)).total, 0);
  }
  await pool.query(`INSERT INTO invoices
    (id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision)
    VALUES(880108,'IFOLDER-MISSING-RECIPIENT-SENTINEL','Unverified legacy mailbox','no-authorised-customer',1,100,10,110,'draft',0,1)`);
  const missingAccount = { id: 21, role: 'client', email: '', permissions: ['VIEW_FINANCE'] };
  const sentinelIndex = await folders({ search: 'IFOLDER-MISSING-RECIPIENT-SENTINEL' });
  assert.equal(sentinelIndex.total, 1, 'The negative ownership test has a real matching stored legacy value.');
  const sentinelKey = sentinelIndex.folders[0].key;
  assert.equal((await invoices({ search: 'IFOLDER-MISSING-RECIPIENT-SENTINEL' }, missingAccount)).total, 0,
    'Missing account email is an empty ownership scope, not an address-shaped sentinel match.');
  assert.equal((await folders({ search: 'IFOLDER-MISSING-RECIPIENT-SENTINEL' }, missingAccount)).total, 0);
  assert.equal((await invoices({ search: 'IFOLDER-MISSING-RECIPIENT-SENTINEL', folder: sentinelKey }, missingAccount)).total, 0);
  assert.equal((await folders({ search: 'IFOLDER-MISSING-RECIPIENT-SENTINEL', folder: sentinelKey }, missingAccount)).total, 0);

  // SQL LOWER and JavaScript's established mailbox ownership normalisation
  // disagree for dotted I and contextual Greek sigma. Unique company labels
  // keep this test about ownership, not a new folder-key normalisation policy.
  const specialMailboxes = [
    [880109, 'Folder Turkish Uppercase', '\u0130-turkish@example.invalid'],
    [880110, 'Folder Turkish ASCII', 'i-turkish@example.invalid'],
    [880111, 'Folder Turkish Combining', 'i\u0307-turkish@example.invalid'],
    [880112, 'Folder Greek Uppercase', '\u039f\u03a3-greek@example.invalid'],
    [880113, 'Folder Greek Final Sigma', '\u03bf\u03c2-greek@example.invalid'],
    [880114, 'Folder Greek Ordinary Sigma', '\u03bf\u03c3-greek@example.invalid']
  ];
  for (const [id, name, recipient] of specialMailboxes) await pool.query(`INSERT INTO invoices
    (id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision)
    VALUES(?,?,?,?,1,100,10,110,'draft',0,1)`, [id, 'IFOLDER-UNICODEOWNERSHIP-' + id, name, recipient]);
  const unicodeIndex = await folders({ search: 'IFOLDER-UNICODEOWNERSHIP-' });
  assert.equal(unicodeIndex.invoice_total, 6);
  assert.equal(unicodeIndex.total, 6);
  const unicodeKeys = new Map(specialMailboxes.map(([id, name]) => [id, unicodeIndex.folders.find(folder => folder.name === name).key]));
  assert.equal(new Set(unicodeKeys.values()).size, 6);
  const ownershipCases = [
    ['i\u0307-turkish@example.invalid', [880109, 880111]],
    ['\u0130-TURKISH@EXAMPLE.INVALID', [880109, 880111]],
    ['i-turkish@example.invalid', [880110]],
    ['\u03bf\u03c2-greek@example.invalid', [880112, 880113]],
    ['\u03bf\u03c3-greek@example.invalid', [880114]]
  ];
  for (const [recipient, expectedIds] of ownershipCases) {
    const client = { id: 21, role: 'client', email: recipient, permissions: ['VIEW_FINANCE'] };
    const visibleFolders = await folders({ search: 'IFOLDER-UNICODEOWNERSHIP-' }, client);
    assert.equal(visibleFolders.invoice_total, expectedIds.length, 'Folder counts follow the established JavaScript mailbox ownership rule.');
    assert.deepEqual(visibleFolders.folders.map(folder => folder.key).sort(), expectedIds.map(id => unicodeKeys.get(id)).sort());
    const visibleRows = await invoices({ search: 'IFOLDER-UNICODEOWNERSHIP-', limit: '100' }, client);
    assert.deepEqual(visibleRows.invoices.map(row => Number(row.id)).sort((a, b) => a - b), expectedIds);
    for (const [id] of specialMailboxes) if (!expectedIds.includes(id)) {
      const foreignKey = unicodeKeys.get(id);
      assert.equal((await invoices({ search: 'IFOLDER-UNICODEOWNERSHIP-', folder: foreignKey }, client)).total, 0,
        'A known foreign key cannot exploit SQL dotted-I/sigma equivalence to broaden mailbox ownership.');
      assert.equal((await folders({ search: 'IFOLDER-UNICODEOWNERSHIP-', folder: foreignKey }, client)).total, 0);
    }
  }

  async function action(method, body) {
    const res = response();
    await controller[method]({ user: admin, body, get: () => 'Synthetic invoice-folder MySQL fixture' }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body;
  }
  await action('deleteInvoice', { invoice_id: main[0].id });
  assert.equal((await invoices({ folder: primary.key })).total, 38);
  const archived = await folders({ archived: 'true' });
  assert.equal(archived.invoice_total, 1);
  assert.equal(archived.folders[0].key, primary.key, 'Archive is a view of the same identity, not a new folder.');
  assert.equal((await invoices({ folder: primary.key, archived: 'true' })).invoices[0].id, main[0].id);
  await action('restoreInvoice', { invoice_id: main[0].id });
  assert.equal((await invoices({ folder: primary.key })).total, 39);
  const [[receiptStillPresent]] = await pool.query('SELECT COUNT(*) count FROM invoice_payments WHERE invoice_id=?', [main[0].id]);
  assert.equal(Number(receiptStillPresent.count), 1, 'Archive/restore must retain payment evidence.');

  const edited = main[1];
  const edit = {
    invoice_id: edited.id, invoice_no: edited.invoice_no,
    customer_name: 'Folder Fixture Corrected Company', customer_email: email,
    gst_rate: 10, expected_revision: 1,
    items: [{ description: 'Synthetic corrected source line', quantity: 1, unit_price: 100 }]
  };
  await action('editInvoice', edit);
  assert.equal((await invoices({ folder: primary.key })).total, 38);
  const afterEdit = await folders();
  const corrected = afterEdit.folders.find(folder => folder.name === edit.customer_name);
  assert(corrected);
  assert.notEqual(corrected.key, primary.key);
  assert.equal(corrected.invoice_count, 1);
  assert.equal((await invoices({ folder: corrected.key })).invoices[0].id, edited.id);
  await action('editInvoice', { ...edit, customer_name: company, expected_revision: 2 });
  assert.equal((await invoices({ folder: primary.key })).total, 39);
  assert.equal((await folders()).total, 16, 'An emptied dynamic folder disappears without deleting its original invoice.');
  const [[editedAudit]] = await pool.query("SELECT COUNT(*) count FROM invoice_activity WHERE invoice_id=? AND action_type='edited'", [edited.id]);
  assert.equal(Number(editedAudit.count), 2, 'Normal invoice edits retain their existing source history.');

  // Simulate a newly persisted invoice without changing the legacy ID schema.
  // The original create endpoint has separate workflow/idempotency tests.
  const addedId = 880058;
  await pool.query(`INSERT INTO invoices(id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision)
    VALUES(?,?,?,?,1,100,10,110,'draft',0,1)`, [addedId, prefix + 'NEW', company, email]);
  const savedAgain = await invoices({ folder: primary.key, limit: '100' });
  assert.equal(savedAgain.total, 40);
  assert(savedAgain.invoices.some(row => Number(row.id) === addedId));
  assert.equal((await folders()).folders.find(folder => folder.key === primary.key).invoice_count, 40,
    'Newly saved invoices appear automatically without any folder-creation write.');
  const [[retained]] = await pool.query(`SELECT COUNT(*) count FROM invoices WHERE id IN (${placeholders})`, ids);
  assert.equal(Number(retained.count), rows.length, 'All original fixture IDs survive edits, archive and restore.');
  assert(unassigned.every(row => row.id !== edited.id));

  facts.push('real SQL complete paged company-folder index and exact all-page contents; Unicode/case/trim and delimiter-collision identity proof; missing-email/unnamed isolation; stable filter/archive keys; literal wildcard search; customer-only scope before aggregation and foreign-key denial; unknown payment totals remain unknown; read-only source/schema/audit/queue preservation; ordinary edit/archive/restore and newly persisted invoices automatically refresh folders without moving records or payments');
};
