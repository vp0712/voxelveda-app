'use strict';

// This suite creates fixtures only in a fresh, explicitly disposable local CI
// database. It must never inherit Railway or another remote database URL.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DATABASE = 'voxelveda_repair_test';
if (process.env.REPAIR_DB_TEST !== 'true' || process.env.NODE_ENV !== 'test') {
  throw new Error('Retained MySQL regression requires NODE_ENV=test and REPAIR_DB_TEST=true.');
}
if (process.env.MYSQL_TEST_DATABASE_URL) {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.MYSQL_TEST_DATABASE_URL) {
    throw new Error('Refusing an inherited DATABASE_URL different from the disposable test URL.');
  }
  process.env.DATABASE_URL = process.env.MYSQL_TEST_DATABASE_URL;
}
const { buildDatabaseConfig } = require('../config/databaseConfig');
const configuration = buildDatabaseConfig(process.env).options;
if (configuration.database !== TEST_DATABASE || !['127.0.0.1', 'localhost', '::1', 'mysql'].includes(configuration.host)) {
  throw new Error('Retained MySQL regression requires the disposable voxelveda_repair_test database on a local CI host.');
}
// Document tests must not upload to object storage or queue external scanners.
process.env.OBJECT_STORAGE_DOCUMENTS_ENABLED = 'false';
delete process.env.MALWARE_SCANNER_PROVIDER;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

const pool = require('../config/db');
const fixtureDirectory = path.join(__dirname, '..', 'uploads', `.retained-mysql-${crypto.randomUUID()}`);
const capturedMessages = [];
let originalSendMail;
const facts = [];
const retiredDocumentId = crypto.randomUUID();
const retiredGrantId = crypto.randomUUID();
const retiredGrantToken = crypto.randomBytes(32).toString('base64url');
const retiredRfqDocumentId = crypto.randomUUID();
let historicalRows;
const historicalColumns = new Map();
const historicalIds = new Map();

function digest(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    cookie(name, value, options) { this.sessionCookie = { name, value, options }; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; }
  };
}

async function historicalState() {
  const tables = ['bank_accounts', 'bank_transactions', 'finance_report_snapshot_chunks', 'invoices', 'suppliers', 'rfqs', 'staff_attendance', 'stock_batches', 'stock_movements'];
  const result = {};
  for (const table of tables) {
    if (!historicalColumns.has(table)) {
      const [columns] = await pool.query('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position', [table]);
      historicalColumns.set(table, columns.map((column) => column.COLUMN_NAME));
      historicalIds.set(table, (await pool.query(`SELECT id FROM ${table} ORDER BY id`))[0].map((row) => row.id));
    }
    const selected = historicalColumns.get(table).map((column) => `\`${column}\``).join(',');
    const ids = historicalIds.get(table);
    result[table] = digest((await pool.query(`SELECT ${selected} FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids))[0]);
  }
  const [[audit]] = await pool.query(`SELECT id,actor_id,action,module,record_id,old_value,new_value,created_at,previous_integrity_hash,integrity_hash FROM audit_logs WHERE id=1`);
  result.audit = digest(audit);
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id=?', [retiredDocumentId]);
  result.document = digest(document);
  const [[rfqDocument]] = await pool.query('SELECT * FROM secure_documents WHERE id=?', [retiredRfqDocumentId]);
  result.rfqDocument = digest(rfqDocument);
  const [[grant]] = await pool.query('SELECT * FROM document_download_grants WHERE id=?', [retiredGrantId]);
  result.grant = digest(grant);
  return result;
}

async function prepareFixtures() {
  const [[identity]] = await pool.query('SELECT DATABASE() AS database_name');
  assert.equal(identity.database_name, TEST_DATABASE, 'Verify the connected database before any DDL.');
  const [tables] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()');
  assert.equal(tables.length, 0, 'The regression requires a fresh disposable database; it never deletes pre-existing tables.');

  await pool.query(`CREATE TABLE users (
    id INT PRIMARY KEY, name VARCHAR(120), username VARCHAR(120), email VARCHAR(180), password VARCHAR(255),
    role VARCHAR(40), permissions JSON, active TINYINT DEFAULT 1, deleted_at DATETIME NULL,
    employee_number VARCHAR(40), department VARCHAR(120), manager_id INT NULL, access_scope JSON NULL
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO users(id,name,username,email,password,role,permissions,active,deleted_at) VALUES
    (20,'Fixture owner','fixture-owner','owner@example.invalid','not-a-login-hash','finance_admin',JSON_ARRAY('VIEW_BANKING','VIEW_RFQS','VIEW_CONFIDENTIAL_FILES'),1,NULL),
    (21,'Other customer','fixture-other','other@example.invalid','not-a-login-hash','viewer',JSON_ARRAY(),1,NULL)`);
  await pool.query(`CREATE TABLE rfqs (
    id INT AUTO_INCREMENT PRIMARY KEY, customer_name VARCHAR(120) NOT NULL,
    email VARCHAR(180) NOT NULL, phone VARCHAR(40), material VARCHAR(120), quantity INT,
    application TEXT, status VARCHAR(30), deleted TINYINT NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO rfqs(customer_name,email,phone,material,quantity,application,status)
    VALUES ('Historical enquiry','history@example.invalid','','Steel',2,'Preserve this enquiry','approved')`);

  // Representative historical data survives selective restoration, including encrypted
  // snapshot bytes. These are synthetic fixtures, never copied production data.
  await pool.query(`CREATE TABLE bank_accounts(id INT PRIMARY KEY,created_by INT,nickname VARCHAR(100),currency CHAR(3),encrypted_details BLOB)`);
  await pool.query(`CREATE TABLE bank_transactions(id INT PRIMARY KEY,bank_account_id INT,transaction_date DATE,debit DECIMAL(18,2),credit DECIMAL(18,2),currency CHAR(3))`);
  await pool.query(`CREATE TABLE finance_report_snapshot_chunks(id INT PRIMARY KEY,report_uid VARCHAR(80),content LONGBLOB)`);
  await pool.query(`CREATE TABLE invoices(id INT PRIMARY KEY,customer_id INT,total DECIMAL(18,2),status VARCHAR(30))`);
  await pool.query(`CREATE TABLE suppliers(id INT PRIMARY KEY,supplier_name VARCHAR(180),email VARCHAR(180),deleted TINYINT NOT NULL DEFAULT 0,private_note TEXT)`);
  await pool.query(`CREATE TABLE staff_attendance(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,clock_in DATETIME NOT NULL,clock_out DATETIME NULL,work_date DATE NOT NULL,total_minutes INT NOT NULL DEFAULT 0,total_hours DECIMAL(8,2) NOT NULL DEFAULT 0,notes TEXT,deleted TINYINT NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE stock_batches(id INT PRIMARY KEY,product_name VARCHAR(180),batch_code VARCHAR(120),unit_qty INT NOT NULL,current_unit_qty INT NOT NULL,deleted TINYINT NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE stock_movements(id INT PRIMARY KEY,stock_id INT,quantity INT,unit_price DECIMAL(10,2),total_price DECIMAL(12,2),created_by INT)`);
  await pool.query('INSERT INTO bank_accounts VALUES(1,20,?, ?, ?)', ['Separate bank identity', 'AUD', Buffer.from([0, 255, 19, 128, 44])]);
  await pool.query("INSERT INTO bank_transactions VALUES(1,1,'2026-09-30',76.80,0,'AUD'),(2,1,'2026-10-01',0,120.40,'AUD')");
  await pool.query('INSERT INTO finance_report_snapshot_chunks VALUES(1,?,?)', ['RPT_fixture_historical', crypto.randomBytes(8192)]);
  await pool.query("INSERT INTO invoices VALUES(1,30,176.80,'unpaid')");
  await pool.query("INSERT INTO suppliers VALUES(1,'Historical supplier','supplier@example.invalid',0,'Preserve ownership and private records')");
  await pool.query("INSERT INTO staff_attendance(user_id,clock_in,clock_out,work_date,total_minutes,total_hours,notes) VALUES(20,'2026-09-28 08:00:00','2026-09-28 16:00:00','2026-09-28',480,8,'Historical unzoned attendance must remain unmodified')");
  await pool.query("INSERT INTO stock_batches VALUES(1,'Historical stock','FIXTURE-001',10,0,0)");
  await pool.query("INSERT INTO stock_movements VALUES(1,1,10,2.5,25,20)");
  await pool.query(`CREATE TABLE audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,actor_id INT NULL,action VARCHAR(120),module VARCHAR(80),
    record_id VARCHAR(80),old_value LONGTEXT,new_value LONGTEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    previous_integrity_hash CHAR(64),integrity_hash CHAR(64)
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO audit_logs(actor_id,action,module,record_id,old_value,new_value,previous_integrity_hash,integrity_hash)
    VALUES(20,'HISTORICAL_IMPORT','finance','fixture-original',NULL,'{"count":2}',NULL,?)`, [digest('historical-chain-head')]);

  const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');
  await ensureSecurityOperationsSchema();
  await pool.query(`INSERT INTO secure_documents
    (id,module,record_type,record_id,owner_user_id,uploaded_by,original_name,stored_name,storage_path,mime_type,size_bytes,content_sha256,classification,access_policy,scan_status)
    VALUES(?, 'finance', 'bank_statement', '1', 20, 20, 'historical.pdf', 'historical.pdf', '/never-open-this-retired-file.pdf', 'application/pdf', 8, ?, 'PUBLIC', 'AUTHENTICATED', 'CLEAN')`,
  [retiredDocumentId, digest(Buffer.from('original'))]);
  const archivedRfqFile = await fileFixture('archived-customer-enquiry.bin', Buffer.from([0, 255, 128, 2, 10]));
  await pool.query(`INSERT INTO secure_documents
    (id,module,record_type,record_id,owner_user_id,uploaded_by,original_name,stored_name,storage_path,mime_type,size_bytes,content_sha256,classification,access_policy,scan_status)
    VALUES(?, 'rfq', 'customer_enquiry', '1', 20, 20, ?, ?, ?, ?, ?, ?, 'CONFIDENTIAL', 'MODULE_OR_OWNER', 'CLEAN')`,
  [retiredRfqDocumentId, archivedRfqFile.originalname, archivedRfqFile.filename, archivedRfqFile.path, archivedRfqFile.mimetype, archivedRfqFile.size, digest(await fs.promises.readFile(archivedRfqFile.path))]);
  await pool.query(`INSERT INTO document_download_grants(id,document_id,token_hash,bound_user_id,created_by,expires_at)
    VALUES(?,?,?,?,20,DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
  [retiredGrantId, retiredDocumentId, digest(Buffer.from(retiredGrantToken)), 20]);
  historicalRows = await historicalState();
}

async function initializeRetainedSchemas() {
  const { inspectOriginalSchema } = require('../services/originalSchemaInventory');
  const before = await inspectOriginalSchema(pool);
  assert.equal(before.compatible, false, 'The legacy fixture deliberately lacks original compatibility structures.');
  // Use the startup helpers against real MySQL, then reload each helper so the
  // second pass actually executes its DDL instead of returning a cached promise.
  const services = [
    ['securitySchema', 'ensureSecuritySchema'],
    ['securityOperationsSchema', 'ensureSecurityOperationsSchema'],
    ['operationalTrustSchema', 'ensureOperationalTrustSchema'],
    ['securityGovernanceSchema', 'ensureSecurityGovernanceSchema'],
    ['emailQueueSchema', 'ensureEmailQueueSchema'],
    ['rfqSchema', 'ensureRfqSchema'], ['hrAdministrationSchema', 'ensureHrAdministrationSchema'],
    ['workforceSchema', 'ensureWorkforceSchema'], ['notificationSchema', 'ensureNotificationSchema'],
    ['trashSchema', 'ensureTrashSchema'], ['workflowSchema', 'ensureWorkflowSchema'],
    ['procurementSchema', 'ensureProcurementSchema'], ['careersSchema', 'ensureCareersSchema'],
    ['employeeIdentitySchema', 'ensureEmployeeIdentitySchema'], ['qmsSchema', 'ensureQmsSchema'],
    ['qmsAdvancedSchema', 'ensureQmsAdvancedSchema'], ['qmsQualityGovernanceSchema', 'ensureQmsQualityGovernanceSchema'],
    ['qmsEnterpriseCompletionSchema', 'ensureQmsEnterpriseCompletionSchema'],
    ['assuranceSchema', 'ensureAssuranceSchema'], ['enterpriseControlPlaneSchema', 'ensureEnterpriseControlPlaneSchema'],
    ['procurementImportSchema', 'ensureProcurementImportSchema'], ['procurementReportService', 'ensureProcurementReportSchema']
  ];
  const controllers = [
    ['invoice', 'ensureInvoiceColumns'], ['customer', 'ensureCustomerTable'], ['stock', 'ensureStockTable'],
    ['material', 'ensureMaterialTable'], ['supplier', 'ensureSupplierTables'], ['meeting', 'ensureMeetingTable'],
    ['task', 'ensureTaskTables'], ['roster', 'ensureRosterTable'], ['attendance', 'ensureAttendanceTables'],
    ['expense', 'ensureExpenseTables'], ['compliance', 'ensureComplianceTables'], ['dashboard', 'ensureDashboardTables']
  ];
  const initializers = services.map(([name, method]) => [`../services/${name}`, method])
    .concat(controllers.map(([name, method]) => [`../controllers/${name}Controller`, method]))
    .concat([['../services/documentDeliveryService', 'ensureDocumentDeliverySchema'], ['../services/weeklyTimesheetDeliverySchema', 'ensureWeeklyTimesheetDeliverySchema']]);
  for (let pass = 0; pass < 2; pass++) {
    for (const [module, method] of initializers) {
      if (pass) delete require.cache[require.resolve(module)];
      await require(module)[method]();
    }
    assert.deepEqual(await historicalState(), historicalRows, 'Every schema pass preserves all original stored values, IDs and attachment bytes.');
  }
  const { splitMigrationSql } = require('../services/migrationRunner');
  for (const sql of splitMigrationSql(fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260915_user_self_profiles.sql'), 'utf8'))) await pool.query(sql);
  assert.deepEqual(await historicalState(), historicalRows, 'Retained startup must preserve historical ledgers, documents, grants and audit values.');
  const after = await inspectOriginalSchema(pool);
  assert.equal(after.compatible, true, JSON.stringify({ missingTables: after.missingTables, missingColumns: after.missingColumns }));
  const [[staff]] = await pool.query('SELECT timesheet_delivery_email FROM users WHERE id=20');
  assert.equal(staff.timesheet_delivery_email, null, 'The delivery designation is never inferred from login email.');
  const [[attendance]] = await pool.query('SELECT timestamp_basis,clock_out_timestamp_basis,manual_authorised_by,break_minutes FROM staff_attendance WHERE id=1');
  assert.deepEqual(attendance, { timestamp_basis: null, clock_out_timestamp_basis: null, manual_authorised_by: null, break_minutes: null }, 'Additive metadata never asserts historical attendance evidence.');
  facts.push(`two real additive startup passes verify ${after.originalTableCount} original base tables and preserve historical rows, zero stock balances and encrypted snapshot bytes`);
}

async function testIdentityAndProfile() {
  const { createAuthenticatedSession } = require('../services/authSessionService');
  const { validateSession, revokeSessionById } = require('../services/sessionService');
  const jwt = require('jsonwebtoken');
  await pool.query('UPDATE users SET department=?,employee_number=? WHERE id=20', ['Archived department fixture', 'ARCHIVED-EMPLOYEE-20']);
  const [[user]] = await pool.query('SELECT * FROM users WHERE id=20');
  const storedPermissions = JSON.stringify(user.permissions);
  const request = { headers: {}, hostname: 'localhost', ip: '127.0.0.1', get: () => 'Retained disposable SQL fixture' };
  const result = response();
  const authenticated = await createAuthenticatedSession({ user, req: request, res: result });
  assert.equal(authenticated.user.role, 'finance_admin', 'Historical identity remains stable without granting a retired role authority.');
  assert.deepEqual(authenticated.user.permissions, ['VIEW_RFQS', 'VIEW_CONFIDENTIAL_FILES']);
  assert.equal(result.sessionCookie.name, 'vv_session');
  assert.equal(result.sessionCookie.options.httpOnly, true);
  const token = result.sessionCookie.value;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.deepEqual(decoded.permissions, ['VIEW_RFQS', 'VIEW_CONFIDENTIAL_FILES']);
  assert.equal((await validateSession(token, decoded)).user_id, 20);
  assert.equal(await revokeSessionById(21, authenticated.sessionId), false, 'Another account cannot revoke the owner session.');
  assert.ok(await validateSession(token, decoded));
  assert.equal(await revokeSessionById(20, authenticated.sessionId), true);
  assert.equal(await validateSession(token, decoded), null);

  const profile = require('../controllers/profileController');
  await pool.query("INSERT INTO user_profiles(user_id,mobile_number) VALUES(21,'+61 400 000 021')");
  const ownerRequest = { ...request, user: { id: 20 }, params: { id: 21 }, query: { user_id: 21 } };
  const own = response();
  await profile.getMyProfile(ownerRequest, own);
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.profile.id, 20, 'Query/path account IDs cannot override the authenticated profile owner.');
  assert.equal(own.body.profile.email, 'owner@example.invalid');
  assert.deepEqual(Object.keys(own.body.profile).sort(), [
    'id', 'user_uuid', 'name', 'username', 'email', 'role', 'account_status',
    'mobile_number', 'timesheet_delivery_email', 'profile_photo_mime', 'profile_photo_size', 'profile_photo_updated_at',
    'profile_updated_at', 'active', 'has_profile_photo', 'profile_photo_url'
  ].sort(), 'The profile DTO exposes only retained identity, contact and photo fields.');
  for (const field of ['department', 'employee_number', 'manager_id', 'access_scope', 'password', 'permissions']) {
    assert.equal(Object.hasOwn(own.body.profile, field), false, `Retired employment/private field ${field} must not enter the profile DTO.`);
  }
  const update = response();
  await profile.updateMyProfile({ ...ownerRequest, body: { name: 'Updated owner', mobile_number: '+61 400 000 020', user_id: 21, role: 'super_admin' } }, update);
  assert.equal(update.statusCode, 200);
  const [[updatedOwner]] = await pool.query('SELECT name,role,permissions,department,employee_number FROM users WHERE id=20');
  const [[other]] = await pool.query('SELECT name,role,permissions FROM users WHERE id=21');
  assert.equal(updatedOwner.name, 'Updated owner');
  assert.equal(updatedOwner.role, 'finance_admin');
  assert.equal(JSON.stringify(updatedOwner.permissions), storedPermissions, 'Authorization projection must not rewrite stored grants.');
  assert.equal(updatedOwner.department, user.department, 'Retired employment records remain unchanged in storage.');
  assert.equal(updatedOwner.employee_number, user.employee_number);
  assert.equal(other.name, 'Other customer');
  assert.equal(other.role, 'viewer');
  const [[otherProfile]] = await pool.query('SELECT mobile_number FROM user_profiles WHERE user_id=21');
  assert.equal(otherProfile.mobile_number, '+61 400 000 021');
  const designated = response();
  await profile.updateMyProfile({ ...ownerRequest, body: { name: updatedOwner.name, mobile_number: '+61 400 000 020', timesheet_delivery_email: 'delivery-owner@EXAMPLE.invalid', user_id: 21 } }, designated);
  assert.equal(designated.statusCode, 200);
  const [designations] = await pool.query('SELECT id,timesheet_delivery_email FROM users WHERE id IN (20,21) ORDER BY id');
  assert.deepEqual(designations, [{ id: 20, timesheet_delivery_email: 'delivery-owner@example.invalid' }, { id: 21, timesheet_delivery_email: null }]);
  const invalidDesignation = response();
  await profile.updateMyProfile({ ...ownerRequest, body: { name: updatedOwner.name, timesheet_delivery_email: 'owner@example.invalid,copy@example.invalid' } }, invalidDesignation);
  assert.equal(invalidDesignation.statusCode, 400, 'Multiple delivery recipients cannot enter storage.');
  const denied = response();
  await profile.updateMyProfile({ ...request, user: {}, body: { name: 'Unauthorized', mobile_number: '+61 400 000 020' } }, denied);
  assert.equal(denied.statusCode, 401);
  facts.push('real authenticated session persistence/revocation, projected active grants, unchanged historical identity, and owner-only profile access/updates');
}

async function testAudit() {
  const audit = require('../services/auditService');
  const first = await audit.logAudit(pool, {
    actorId: 20, action: 'PROFILE_UPDATED', module: 'profile', recordId: '20',
    newValue: { name: 'Fixture updated', password: 'must-not-enter-audit' }, requestId: 'mysql-fixture-a'
  });
  const second = await audit.logAudit(pool, {
    actorId: 20, action: 'SESSION_REVOKED', module: 'security', recordId: 'session-fixture', requestId: 'mysql-fixture-b'
  });
  const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY id');
  assert.equal(rows.length, 3);
  assert.equal(rows[1].previous_integrity_hash, rows[0].integrity_hash);
  assert.equal(rows[2].previous_integrity_hash, first);
  assert.equal(rows[2].integrity_hash, second);
  assert.doesNotMatch(JSON.stringify(rows), /must-not-enter-audit/);
  for (const row of rows.slice(1)) {
    const payload = audit.canonicalAuditPayload({
      previousHash: row.previous_integrity_hash, actorId: row.actor_id, action: row.action,
      module: row.module, recordType: row.record_type, recordId: row.record_id,
      oldValue: row.old_value, newValue: row.new_value, requestId: row.request_id,
      sessionId: row.session_id, result: row.result, metadata: row.metadata_json === null ? null : JSON.stringify(row.metadata_json)
    });
    assert.equal(digest(Buffer.from(JSON.stringify(payload))), row.integrity_hash, 'Persisted audit fields must reproduce the integrity hash.');
  }
  facts.push('real SQL audit entries remain redacted and continue the existing integrity chain');
}

async function fileFixture(name, content) {
  await fs.promises.mkdir(fixtureDirectory, { recursive: true });
  const filename = path.join(fixtureDirectory, name);
  await fs.promises.writeFile(filename, content);
  return { path: filename, originalname: name, filename: name, mimetype: 'application/octet-stream', size: content.length, malwareScan: { status: 'CLEAN' } };
}

async function testDocuments() {
  const documents = require('../services/documentSecurityService');
  const { createDocumentPdf, validatePdf } = require('../services/documentPdfService');
  const owner = { id: 20, role: 'staff', permissions: [] };
  const other = { id: 21, role: 'viewer', permissions: [] };
  const { buffer: body } = await createDocumentPdf({ title: 'ACCOUNT DOCUMENT', reference: 'FIXTURE-PROFILE-20', party: 'Fixture owner', columns: [{ label: 'Record', width: 1 }], rows: [['Stored private profile fixture']] });
  const file = await fileFixture('account-document.pdf', body);
  file.mimetype = 'application/pdf';
  const saved = await documents.registerDocument({ module: 'profile', recordType: 'account_document', recordId: '20', ownerUserId: 20, uploadedBy: 20, file });
  assert.equal((await documents.getAuthorisedDocument(owner, saved.id)).status, 200);
  assert.equal((await documents.getAuthorisedDocument(other, saved.id)).status, 403, 'A different customer cannot read the owner attachment.');
  assert.equal((await documents.getAuthorisedDocument({ ...other, permissions: ['VIEW_CONFIDENTIAL_FILES'] }, saved.id)).status, 200);
  const loaded = await documents.readDocumentBodyInternal(saved.id);
  assert.deepEqual(loaded.body, body);
  assert.equal(loaded.contentSha256, digest(body));

  const deniedGrant = response();
  await documents.createDocumentGrant({ user: other, params: { id: saved.id }, body: {} }, deniedGrant);
  assert.equal(deniedGrant.statusCode, 403);
  const granted = response();
  await documents.createDocumentGrant({ user: owner, params: { id: saved.id }, body: {} }, granted);
  assert.equal(granted.statusCode, 201);
  const token = granted.body.grant_url.split('/').at(-1);
  const wrongUser = response();
  await documents.sendGrantedDocument({ user: other, params: { token } }, wrongUser);
  assert.equal(wrongUser.statusCode, 404);
  const [[grant]] = await pool.query('SELECT * FROM document_download_grants WHERE token_hash=?', [digest(Buffer.from(token))]);
  assert.equal(grant.bound_user_id, 20);
  assert.equal(grant.used_at, null, 'A rejected customer must not consume another customer grant.');
  const download = response();
  await documents.sendGrantedDocument({ user: owner, params: { token } }, download);
  assert.deepEqual(download.body, body, 'The owner grant returns the exact validated PDF bytes.');
  assert.equal(download.headers['content-type'], 'application/pdf');
  await validatePdf(download.body, { expectedText: ['FIXTURE-PROFILE-20', 'Fixture owner'] });
  const reused = response();
  await documents.sendGrantedDocument({ user: owner, params: { token } }, reused);
  assert.equal(reused.statusCode, 404, 'A completed single-use grant cannot be reused.');

  for (const user of [owner, other, { id: 20, role: 'super_admin', permissions: [] }]) {
    assert.equal((await documents.getAuthorisedDocument(user, retiredDocumentId)).status, 410, 'Owner, admin and public classification cannot bypass module retirement.');
  }
  for (const method of ['readDocumentBodyInternal', 'removeDocumentInternal']) {
    await assert.rejects(() => documents[method](retiredDocumentId), { code: 'MODULE_RETIRED', status: 410 });
  }
  const retiredGrant = response();
  await documents.sendGrantedDocument({ user: owner, params: { token: retiredGrantToken } }, retiredGrant);
  assert.equal(retiredGrant.statusCode, 410);
  await assert.rejects(() => documents.registerDocument({ module: 'finance', recordType: 'statement', recordId: '1', ownerUserId: 20, uploadedBy: 20, file }), { code: 'MODULE_RETIRED' });
  assert.equal((await documents.getAuthorisedDocument(owner, retiredRfqDocumentId)).status, 200, 'Original RFQ owners regain access to their preserved sources.');
  assert.equal((await documents.getAuthorisedDocument(other, retiredRfqDocumentId)).status, 403, 'Unrelated users cannot read a restored RFQ source.');
  assert.equal((await documents.getAuthorisedDocument({ id: 22, role: 'staff', permissions: ['VIEW_RFQS'] }, retiredRfqDocumentId)).status, 200, 'Original staff module permission can read an RFQ source.');
  assert.equal((await documents.getAuthorisedDocument({ id: 21, role: 'customer', email: 'other@example.invalid', permissions: ['VIEW_RFQS'] }, retiredRfqDocumentId)).status, 403, 'Customer document scope is checked against the original RFQ customer email.');
  const archivedBody = await documents.readDocumentBodyInternal(retiredRfqDocumentId);
  assert.deepEqual(archivedBody.body, Buffer.from([0, 255, 128, 2, 10]));
  const unsupported = response();
  await documents.sendDocument({ user: owner, params: { id: retiredRfqDocumentId } }, unsupported);
  assert.equal(unsupported.statusCode, 422);
  assert.equal(unsupported.body.code, 'PDF_SOURCE_FORMAT_UNSUPPORTED', 'Unsupported original sources are preserved and do not become mislabeled PDF downloads.');
  const unsupportedGrant = response();
  await documents.createDocumentGrant({ user: owner, params: { id: retiredRfqDocumentId }, body: {} }, unsupportedGrant);
  const unsupportedToken = unsupportedGrant.body.grant_url.split('/').at(-1);
  const failedGrant = response();
  await documents.sendGrantedDocument({ user: owner, params: { token: unsupportedToken } }, failedGrant);
  assert.equal(failedGrant.statusCode, 422);
  const [[unconsumed]] = await pool.query('SELECT used_at FROM document_download_grants WHERE token_hash=?', [digest(Buffer.from(unsupportedToken))]);
  assert.equal(unconsumed.used_at, null, 'Failed PDF conversion must not consume the owner download grant.');
  const restored = await documents.registerDocument({ module: 'rfq', recordType: 'customer_enquiry', recordId: '1', ownerUserId: 20, uploadedBy: 20, file });
  assert.equal((await documents.getAuthorisedDocument(owner, restored.id)).status, 200);
  const [[archivedRfq]] = await pool.query('SELECT storage_path,content_sha256 FROM secure_documents WHERE id=?', [retiredRfqDocumentId]);
  assert.equal(digest(await fs.promises.readFile(archivedRfq.storage_path)), archivedRfq.content_sha256, 'Archived RFQ attachment bytes remain intact.');
  assert.deepEqual(await historicalState(), historicalRows, 'Read/grant/delete attempts must leave retired documents, grants and historical records untouched.');
  facts.push('exact validated profile/RFQ PDF bytes and owner-bound single-use grants; unsupported original RFQ sources/grants remain intact; Banking/added Finance access remains denied');
}

async function testQueue() {
  const { createDocumentPdf, validatePdf } = require('../services/documentPdfService');
  const emailService = require('../services/emailService');
  originalSendMail = emailService.sendMail;
  emailService.sendMail = async (message) => {
    assert.ok(message.to.every((address) => /@example\.invalid$/.test(address)), 'No real recipient is permitted.');
    capturedMessages.push(message);
    return { messageId: `fixture-accepted-${capturedMessages.length}`, status: 'PROVIDER_ACCEPTED', receivedVerified: false };
  };
  delete require.cache[require.resolve('../services/emailQueue')];
  let queue = require('../services/emailQueue');
  const retiredRows = [];
  for (const module of ['finance', 'erp', 'customer_rfqs', null]) {
    const [insert] = await pool.query(`INSERT INTO email_queue(to_json,subject,attachments_json,related_module,status,scheduled_at,idempotency_key)
      VALUES(?,?,?,?,'PENDING','2000-01-01',?)`,
    [JSON.stringify(['historical@example.invalid']), 'Retired message to preserve', JSON.stringify([{ filename: 'historical.pdf', content: 'retain-exact-content' }]), module, `historical-${module}`]);
    retiredRows.push(insert.insertId);
  }
  const queryRetired = () => pool.query(`SELECT * FROM email_queue WHERE id IN (${retiredRows.map(() => '?').join(',')}) ORDER BY id`, retiredRows);
  const retiredBefore = digest((await queryRetired())[0]);
  const { buffer: bytes } = await createDocumentPdf({ title: 'QUEUE REGRESSION', reference: 'FIXTURE-QUEUE-20', party: 'Fixture owner', columns: [{ label: 'Record', width: 1 }], rows: [['Durable queued attachment after original upload removal']] });
  const temporary = await fileFixture('temporary-upload.pdf', bytes);
  const message = { relatedModule: 'security', relatedRecordId: '20', to: ['fixture@example.invalid'], subject: 'Disposable queue test',
    text: 'No real email transport is called.', scheduledAt: new Date('2000-01-01T00:00:00Z'), idempotencyKey: 'retained-mysql-queue',
    attachments: [{ path: temporary.path, filename: 'account-notification.pdf', contentType: 'application/pdf', contentDisposition: 'attachment' }] };
  const ids = await Promise.all(Array.from({ length: 6 }, () => queue.queueEmail(message)));
  const id = ids[0];
  assert.ok(id);
  assert.ok(ids.every((savedId) => savedId === id), 'Concurrent inserts share one actual unique queue key.');
  await fs.promises.unlink(temporary.path);
  const [[stored]] = await pool.query('SELECT attachments_json FROM email_queue WHERE id=?', [id]);
  assert.doesNotMatch(stored.attachments_json, /temporary-upload|\/uploads\//, 'Durable content cannot rely on a removed upload path.');
  const attachment = JSON.parse(stored.attachments_json)[0];
  assert.equal(attachment.filename, 'account-notification.pdf');
  assert.equal(attachment.byteLength, bytes.length);
  assert.equal(attachment.sha256, digest(bytes));

  // Simulate a fresh module/worker after the original upload has disappeared.
  delete require.cache[require.resolve('../services/emailQueue')];
  delete require.cache[require.resolve('../services/emailQueueSchema')];
  queue = require('../services/emailQueue');
  await require('../services/weeklyTimesheetDeliverySchema').ensureWeeklyTimesheetDeliverySchema();
  const outcomes = (await Promise.all([queue.processEmailQueue(50), queue.processEmailQueue(50)])).flat();
  assert.deepEqual(outcomes, [{ id, status: 'SENT', provider_accepted: true, recipient_verified: false }]);
  assert.equal(capturedMessages.length, 1);
  assert.deepEqual(capturedMessages[0].attachments[0].content, bytes);
  assert.equal(capturedMessages[0].attachments[0].filename, 'account-notification.pdf');
  assert.equal(capturedMessages[0].attachments[0].contentType, 'application/pdf');
  assert.equal(capturedMessages[0].attachments[0].contentDisposition, 'attachment');
  await validatePdf(capturedMessages[0].attachments[0].content, { expectedText: ['FIXTURE-QUEUE-20'] });
  const [[claimed]] = await pool.query('SELECT status,attempts,claimed_at,provider_accepted_at,recipient_verified_at FROM email_queue WHERE id=?', [id]);
  assert.equal(claimed.status, 'SENT');
  assert.equal(claimed.attempts, 1, 'Only one concurrent worker can claim the queued row.');
  assert.ok(claimed.claimed_at);
  assert.ok(claimed.provider_accepted_at);
  assert.equal(claimed.recipient_verified_at, null, 'A mocked provider acceptance never claims receipt verification.');
  assert.deepEqual(await queue.processEmailQueue(50), []);
  assert.equal(digest((await queryRetired())[0]), retiredBefore, 'Retired and unclassified queue rows remain byte-for-byte intact and unclaimed.');
  for (const relatedModule of ['finance', 'erp', 'customer_rfqs', undefined]) {
    await assert.rejects(() => queue.queueEmail({ ...message, relatedModule, attachments: [] }), { code: 'EMAIL_MODULE_RETIRED' });
  }
  const [[log]] = await pool.query('SELECT * FROM email_logs WHERE queue_id=?', [id]);
  assert.equal(log.status, 'SENT');
  assert.equal(log.provider_message_id, 'fixture-accepted-1');
  const restoredId = await queue.queueEmail({ ...message, relatedModule: 'rfq', idempotencyKey: 'restored-rfq-queue', attachments: [] });
  assert.deepEqual(await queue.processEmailQueue(50), [{ id: restoredId, status: 'SENT', provider_accepted: true, recipient_verified: false }]);
  await assert.rejects(() => queue.queueEmail({ ...message, attachments: [{ filename: 'disguised.pdf', content: Buffer.from('<html>invalid document</html>') }] }), { code: 'PDF_DOCUMENT_INVALID' });
  await testStaleQueueReview(queue);
  facts.push('real unique-key/concurrent worker claims deliver one validated durable PDF after upload deletion/restart, restore original RFQ email and preserve retired/unclassified rows; transport is mocked');
}

async function testStaleQueueReview(queue) {
  const [insert] = await pool.query(`INSERT INTO email_queue(to_json,subject,related_module,status,attempts,scheduled_at,claimed_at,provider_accepted_at,idempotency_key)
    VALUES('["review@example.invalid"]','Uncertain weekly transport','timesheets','SENDING',3,'2000-01-01','2000-01-01','2000-01-01',?)`, ['weekly-timesheet:30:2000-01-03:2000-01-09:v1']);
  const queueId = insert.insertId;
  const hash = digest('Retain frozen stale source');
  const snapshot = JSON.stringify({ fixture: 'Retain frozen stale source', staff_id: 30 });
  const [deliveryInsert] = await pool.query(`INSERT INTO weekly_timesheet_deliveries(user_id,period_start,period_end,timezone,status,recipient,source_sha256,snapshot_json,total_minutes,email_queue_id,provider_accepted_at)
    VALUES(30,'2000-01-03','2000-01-09','Australia/Sydney','QUEUED','review@example.invalid',?,?,480,?,'2000-01-01')`, [hash, snapshot, queueId]);
  await pool.query(`INSERT INTO weekly_timesheet_delivery_versions(delivery_id,version,user_id,period_start,period_end,recipient,source_sha256,snapshot_json,total_minutes,email_queue_id,status)
    VALUES(?,1,30,'2000-01-03','2000-01-09','review@example.invalid',?,?,480,?,'QUEUED')`, [deliveryInsert.insertId, hash, snapshot, queueId]);
  const [[originalQueue]] = await pool.query('SELECT provider_accepted_at FROM email_queue WHERE id=?', [queueId]);
  const [[originalDelivery]] = await pool.query('SELECT provider_accepted_at FROM weekly_timesheet_deliveries WHERE id=?', [deliveryInsert.insertId]);
  const sentBefore = capturedMessages.length;
  assert.deepEqual(await queue.processEmailQueue(50), [], 'Stale SENDING rows are held for review and never automatically resent.');
  assert.equal(capturedMessages.length, sentBefore);
  const [[savedQueue]] = await pool.query('SELECT status,attempts,provider_accepted_at,next_attempt_at FROM email_queue WHERE id=?', [queueId]);
  assert.equal(savedQueue.status, 'REVIEW_REQUIRED');
  assert.equal(savedQueue.attempts, 3);
  assert.deepEqual(savedQueue.provider_accepted_at, originalQueue.provider_accepted_at, 'Known provider acceptance is never cleared or replaced during crash recovery.');
  assert.equal(savedQueue.next_attempt_at, null);
  const [[delivery]] = await pool.query('SELECT status,last_error_code,source_sha256,snapshot_json,provider_accepted_at,email_queue_id FROM weekly_timesheet_deliveries WHERE id=?', [deliveryInsert.insertId]);
  const [[version]] = await pool.query('SELECT status,source_sha256,snapshot_json,email_queue_id FROM weekly_timesheet_delivery_versions WHERE delivery_id=?', [deliveryInsert.insertId]);
  assert.equal(delivery.status, 'REVIEW_REQUIRED');
  assert.equal(delivery.last_error_code, 'WORKER_TRANSPORT_UNCERTAIN');
  assert.deepEqual(delivery.provider_accepted_at, originalDelivery.provider_accepted_at);
  assert.equal(version.status, 'REVIEW_REQUIRED');
  for (const row of [delivery, version]) {
    assert.equal(row.source_sha256, hash);
    assert.equal(row.snapshot_json, snapshot);
    assert.equal(row.email_queue_id, queueId);
  }
  facts.push('real atomic multi-table stale transport review keeps queue/current delivery/version consistent without clearing frozen sources or known acceptance');
}

async function makeWeeklyFixtureDue(queueId) {
  // This fixture calls the worker immediately. MySQL DATETIME(0) can round a
  // default JavaScript enqueue time into the next second. Make only this
  // synthetic row due; retain the real period/source/recipient validators.
  const [due] = await pool.query(`UPDATE email_queue SET scheduled_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE)
    WHERE id=? AND related_module='timesheets' AND status='PENDING'
      AND scheduled_at<=DATE_ADD(NOW(),INTERVAL 1 SECOND)`, [queueId]);
  assert.equal(due.affectedRows, 1, 'Only an immediately queued pending weekly fixture may have its worker due time adjusted.');
}

async function testWeeklyDelivery() {
  const { DateTime } = require('luxon');
  const policy = require('../services/weeklyTimesheetEligibility');
  const { validatePdf } = require('../services/documentPdfService');
  const queue = require('../services/emailQueue');
  process.env.TIMESHEET_TIMEZONE = 'Australia/Sydney';
  process.env.WEEKLY_TIMESHEET_EMAIL_TIMEZONE = 'Australia/Sydney';
  process.env.WEEKLY_TIMESHEET_EMAIL_ENABLED = 'true';
  process.env.WEEKLY_TIMESHEET_EMAIL_WEEKDAY = '1';
  process.env.WEEKLY_TIMESHEET_EMAIL_HOUR = '7';
  process.env.WEEKLY_TIMESHEET_EMAIL_MINUTE = '0';
  process.env.WEEKLY_TIMESHEET_EMAIL_WINDOW_MINUTES = '120';
  delete process.env.ATTENDANCE_STORAGE_TIMEZONE;
  const period = policy.latestCompletedWeek(new Date(), 'Australia/Sydney');
  const scheduledNow = DateTime.fromISO(period.end, { zone: 'Australia/Sydney' }).plus({ days: 1 }).set({ hour: 7, minute: 30 }).toJSDate();
  await pool.query(`INSERT INTO users(id,name,username,email,password,role,permissions,active,employee_number,timesheet_delivery_email) VALUES
    (30,'Worked fixture employee','worked-fixture','login-only-30@example.invalid','not-a-login-hash','staff',JSON_ARRAY(),1,'FIXTURE-STAFF-30','weekly-30@example.invalid'),
    (31,'No-work fixture employee','no-work-fixture','login-only-31@example.invalid','not-a-login-hash','staff',JSON_ARRAY(),1,'FIXTURE-STAFF-31','weekly-31@example.invalid'),
    (32,'Planned fixture employee','planned-fixture','login-only-32@example.invalid','not-a-login-hash','staff',JSON_ARRAY(),1,'FIXTURE-STAFF-32','weekly-32@example.invalid'),
    (33,'Missing designation fixture','missing-delivery-fixture','login-only-33@example.invalid','not-a-login-hash','staff',JSON_ARRAY(),1,'FIXTURE-STAFF-33',NULL)`);
  const start = DateTime.fromISO(period.start, { zone: 'Australia/Sydney' }).set({ hour: 8 });
  for (const staffId of [30, 32, 33]) {
    await pool.query(`INSERT INTO staff_attendance(user_id,clock_in,clock_out,work_date,total_minutes,total_hours,notes,
      break_minutes,entry_source,timestamp_basis,clock_out_timestamp_basis,recorded_timezone,attendance_status)
      VALUES(?,?,?,?,480,8,?,0,'CLOCK','UTC','UTC','Australia/Sydney',?)`,
    [staffId, start.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), start.plus({ hours: 8 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), period.start,
      `Only fixture employee ${staffId} source`, staffId === 32 ? 'PLANNED' : 'COMPLETED']);
  }
  delete require.cache[require.resolve('../services/weeklyTimesheetScheduler')];
  let scheduler = require('../services/weeklyTimesheetScheduler');
  const options = { now: scheduledNow, env: process.env };
  await Promise.all([scheduler.queueClosedWeekTimesheets(options), scheduler.queueClosedWeekTimesheets(options)]);
  const [deliveries] = await pool.query('SELECT * FROM weekly_timesheet_deliveries WHERE period_start=? AND period_end=? ORDER BY user_id', [period.start, period.end]);
  assert.deepEqual(deliveries.map((row) => [row.user_id, row.status]), [[30, 'QUEUED'], [32, 'NO_WORK'], [33, 'NO_RECIPIENT']]);
  const worked = deliveries[0];
  assert.equal(worked.total_minutes, 480);
  assert.equal(worked.recipient, 'weekly-30@example.invalid');
  assert.ok(worked.document_request_id);
  assert.equal(worked.claim_token, null);
  assert.equal(worked.claim_expires_at, null);
  const [[savedQueue]] = await pool.query('SELECT * FROM email_queue WHERE id=?', [worked.email_queue_id]);
  assert.deepEqual(JSON.parse(savedQueue.to_json), ['weekly-30@example.invalid']);
  assert.deepEqual(JSON.parse(savedQueue.cc_json), []);
  assert.deepEqual(JSON.parse(savedQueue.bcc_json), []);
  assert.equal(JSON.parse(savedQueue.delivery_policy_json).sourceHash, worked.source_sha256);
  const attachments = queue.restoreAttachments(JSON.parse(savedQueue.attachments_json));
  assert.equal(attachments.length, 1);
  const parsed = await validatePdf(attachments[0].content, { expectedText: ['Worked fixture employee', period.start, period.end, '8.00'] });
  assert.doesNotMatch(parsed.text, /No-work fixture|Planned fixture|Missing designation|login-only/);
  const [[request]] = await pool.query('SELECT generation_status,pdf_sha256,email_queue_id FROM document_delivery_requests WHERE id=?', [worked.document_request_id]);
  assert.deepEqual(request, { generation_status: 'VALIDATED', pdf_sha256: digest(attachments[0].content), email_queue_id: worked.email_queue_id });
  delete require.cache[require.resolve('../services/weeklyTimesheetScheduler')];
  scheduler = require('../services/weeklyTimesheetScheduler');
  await scheduler.queueClosedWeekTimesheets(options);
  const [[queueCount]] = await pool.query("SELECT COUNT(*) AS count FROM email_queue WHERE idempotency_key LIKE ?", [`weekly-timesheet:30:${period.start}:${period.end}:v%`]);
  assert.equal(queueCount.count, 1, 'Concurrent and restarted schedulers produce exactly one immutable staff/week queue.');
  const sentBefore = capturedMessages.length;
  await makeWeeklyFixtureDue(worked.email_queue_id);
  assert.deepEqual(await queue.processEmailQueue(50), [{ id: worked.email_queue_id, status: 'SENT', provider_accepted: true, recipient_verified: false }]);
  assert.equal(capturedMessages.length, sentBefore + 1);
  assert.deepEqual(capturedMessages.at(-1).attachments[0].content, attachments[0].content, 'Worker transport uses the same staff-specific validated queue PDF.');
  await pool.query('UPDATE staff_attendance SET notes=? WHERE user_id=30 AND work_date=?', ['Authorised fixture correction', period.start]);
  await scheduler.queueClosedWeekTimesheets(options);
  assert.deepEqual(await queue.processEmailQueue(50), [], 'Saved work corrections never automatically resend an accepted staff/week PDF.');
  const [[acceptedHistory]] = await pool.query('SELECT status,source_sha256,snapshot_json,email_queue_id FROM weekly_timesheet_delivery_versions WHERE delivery_id=? AND version=1', [worked.id]);
  assert.deepEqual(acceptedHistory, { status: 'SENT', source_sha256: worked.source_sha256, snapshot_json: worked.snapshot_json, email_queue_id: worked.email_queue_id });
  const revision = await scheduler.queueWeeklyTimesheetRevision({ ...options, deliveryId: worked.id, expectedVersion: 1, reason: 'Correct fixture work description', actor: { id: 20, role: 'admin' } });
  assert.equal(revision.version, 2);
  const [[retainedOriginal]] = await pool.query('SELECT status,source_sha256,snapshot_json,email_queue_id FROM weekly_timesheet_delivery_versions WHERE delivery_id=? AND version=1', [worked.id]);
  assert.deepEqual(retainedOriginal, acceptedHistory, 'An explicit audited revision preserves the original accepted PDF/version identity.');
  const [[revisionRequest]] = await pool.query('SELECT email_queue_id,pdf_sha256,generation_status FROM document_delivery_requests WHERE id=?', [revision.request_id]);
  assert.equal(revisionRequest.generation_status, 'VALIDATED');
  assert.equal(revisionRequest.email_queue_id, revision.queue_id);
  await makeWeeklyFixtureDue(revision.queue_id);
  await pool.query("UPDATE users SET timesheet_delivery_email='changed-30@example.invalid' WHERE id=30");
  const held = await queue.processEmailQueue(50);
  assert.equal(held.length, 1);
  assert.equal(held[0].id, revision.queue_id);
  assert.equal(held[0].status, 'REVIEW_REQUIRED', 'Final locked eligibility recheck blocks a changed designated recipient.');
  assert.equal(capturedMessages.length, sentBefore + 1);
  const [[heldDelivery]] = await pool.query('SELECT status FROM weekly_timesheet_deliveries WHERE id=?', [worked.id]);
  assert.equal(heldDelivery.status, 'REVIEW_REQUIRED');
  facts.push('real worked-only weekly scheduling/locks/PDF linkage, staff-period/version uniqueness, restart deduplication, accepted history preservation, explicit revision and final recipient-change hold');
}

async function testProcurementRecordsAndSnapshots() {
  const entries = require('../services/procurementEntryService');
  const reports = require('../services/procurementReportService');
  const { validatePdf } = require('../services/documentPdfService');
  const owner = { id: 20, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const other = { id: 21, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const manager = { id: 22, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'MANAGE_PROCUREMENT_RECORDS'] };
  const request = (key = null) => ({ ip: '127.0.0.1', id: 'disposable-procurement-regression', get: (name) => String(name).toLowerCase() === 'idempotency-key' ? key : 'Synthetic MySQL integration fixture' });
  const firstInput = { classification: 'PLAN', title: 'Exact decimal procurement fixture', category: 'Materials', priority: 'HIGH', phase: 'Preparation', reference: 'FIXTURE-PRC-001', supplier_name: 'Synthetic supplier', date: '2026-10-12', currency: 'AUD', description: 'Exact decimal quantity', quantity: '1.005', unit: 'kg', unit_price: '1.00', tax_rate: '0' };
  const created = await entries.createEntry({ user: owner, input: firstInput, req: request('mysql-procurement-repeat-1') });
  assert.match(created.entry.record_no, /^PRC-\d{4}-\d{6,}$/);
  const repeated = await entries.createEntry({ user: owner, input: firstInput, req: request('mysql-procurement-repeat-1') });
  assert.equal(repeated.existing, true);
  assert.equal(repeated.entry.id, created.entry.id);
  assert.equal(String(created.entry.total), '1.01');
  await assert.rejects(() => entries.createEntry({ user: owner, input: { ...firstInput, title: 'Conflicting retry' }, req: request('mysql-procurement-repeat-1') }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(() => entries.createEntry({ user: owner, input: { ...firstInput, quantity: '1.0001' }, req: request() }), { code: 'ENTRY_VALIDATION_FAILED' });
  await assert.rejects(() => entries.getEntry({ user: other, id: created.entry.id }), { code: 'PROCUREMENT_RECORD_NOT_FOUND' });
  assert.equal((await entries.getEntry({ user: manager, id: created.entry.id })).id, created.entry.id);
  await entries.createEntry({ user: other, input: { ...firstInput, title: 'Other owner private procurement fixture', quantity: '100', unit_price: '100' }, req: request() });
  const secondInput = { ...firstInput, reference: 'FIXTURE-PRC-002', title: 'Tax-inclusive procurement fixture', description: 'Recorded procurement units', quantity: '2', unit: 'ea', unit_price: '10', tax_rate: '10', date: '2026-10-13' };
  const second = await entries.createEntry({ user: owner, input: secondInput, req: request() });
  for (let index = 1; index <= 30; index++) {
    await entries.createEntry({ user: owner, input: { ...firstInput, title: `Full register fixture item ${String(index).padStart(2, '0')}`, description: `Full register fixture item ${String(index).padStart(2, '0')}`, reference: `FIXTURE-FULL-${index}`, quantity: '1', unit: 'ea', unit_price: '1', date: '2026-10-13' }, req: request() });
  }
  await entries.createEntry({ user: owner, input: { ...firstInput, classification: 'QUOTATION', title: 'Excluded quotation fixture', quantity: '7', unit_price: '2' }, req: request() });
  const filters = { classification: 'PLAN', category: 'Materials', priority: 'HIGH', phase: 'Preparation', status: 'DRAFT', currency: 'AUD', from_date: '2026-10-12', to_date: '2026-10-13', sort: 'date_asc' };
  const listing = await entries.listEntries({ user: owner, filters: { ...filters, page: 1, page_size: 1 } });
  assert.equal(listing.entries.length, 1);
  assert.equal(listing.total, 32);
  assert.equal(listing.pages, 32);
  assert.equal(listing.summary.record_count, 32);
  assert.equal(listing.summary.currency_totals.length, 1);
  assert.equal(String(listing.summary.currency_totals[0].total), '53.01', 'Filtered totals cover all matching records, independently of the visible page and other owners.');
  assert.deepEqual(listing.summary.quantity_totals.map((group) => [group.unit, String(group.quantity)]).sort(), [['ea', '32.000'], ['kg', '1.005']], 'Different recorded units remain separate in full filtered totals.');
  const input = { type: 'register', source: 'entries', filters };
  const snapshots = await Promise.all([reports.createSnapshot({ user: owner, input, req: request() }), reports.createSnapshot({ user: owner, input, req: request() })]);
  assert.equal(snapshots[0].snapshot_id, snapshots[1].snapshot_id, 'Real snapshot uniqueness shares one immutable request under competing generation.');
  const snapshot = await reports.getSnapshot({ user: owner, snapshotId: snapshots[0].snapshot_id });
  assert.equal(snapshot.generation_status, 'VALIDATED');
  assert.equal(snapshot.record_count, 32);
  const source = JSON.parse(snapshot.source_json);
  assert.equal(source.records.length, 32);
  assert.ok(source.records.every((record) => Number(record.owner_user_id) === owner.id && record.classification === 'PLAN'));
  const artifact = await reports.snapshotArtifact(snapshot);
  await validatePdf(artifact.buffer, { expectedText: [snapshot.reference, 'Full register fixture item 30', 'AUD 53.01'] });
  await assert.rejects(() => reports.getSnapshot({ user: other, snapshotId: snapshot.id }), { code: 'PROCUREMENT_REPORT_NOT_FOUND' });
  await assert.rejects(() => reports.createSnapshot({ user: owner, input: { type: 'selected', source: 'entries', ids: [created.entry.id, '00000000-0000-4000-8000-000000000001'] }, req: request() }), { code: 'PROCUREMENT_SELECTION_UNAVAILABLE' });
  const beforeMutation = { source: snapshot.source_json, hash: snapshot.pdf_sha256, bytes: Buffer.from(artifact.buffer) };
  const roundTripEdit = await entries.getEntry({ user: owner, id: created.entry.id });
  assert.equal(roundTripEdit.tax_rate, '0', 'A DECIMAL tax rate read from MySQL must remain valid when the public DTO is edited.');
  const edits = await Promise.allSettled([
    entries.editEntry({ user: owner, id: created.entry.id, input: { ...roundTripEdit, title: 'First competing edit', expected_revision: roundTripEdit.revision }, req: request() }),
    entries.editEntry({ user: owner, id: created.entry.id, input: { ...roundTripEdit, title: 'Second competing edit', expected_revision: roundTripEdit.revision }, req: request() })
  ]);
  assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(edits.find((result) => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const revised = await entries.getEntry({ user: owner, id: created.entry.id });
  assert.equal(revised.revision, 2);
  await assert.rejects(() => entries.editEntry({ user: other, id: created.entry.id, input: { ...firstInput, expected_revision: 2 }, req: request() }), { code: 'PROCUREMENT_RECORD_NOT_FOUND' });
  const archived = await entries.archiveEntry({ user: owner, id: second.entry.id, input: { expected_revision: 1, reason: 'Archive synthetic duplicate document' }, req: request() });
  assert.equal(archived.entry.status, 'ARCHIVED');
  assert.equal((await entries.listEntries({ user: owner, filters: { ...filters, status: 'ARCHIVED' } })).total, 1);
  const restored = await entries.archiveEntry({ user: owner, id: second.entry.id, input: { expected_revision: 2 }, req: request(), restore: true });
  assert.equal(restored.entry.id, second.entry.id);
  assert.equal(restored.entry.revision, 3);
  assert.equal(restored.entry.status, 'DRAFT');
  const history = (await entries.getEntry({ user: owner, id: second.entry.id })).history;
  assert.deepEqual(history.map((version) => version.action), ['RESTORED', 'ARCHIVED', 'CREATED']);
  delete require.cache[require.resolve('../services/procurementReportService')];
  const restartedReports = require('../services/procurementReportService');
  const retained = await restartedReports.getSnapshot({ user: owner, snapshotId: snapshot.id });
  assert.equal(retained.source_json, beforeMutation.source);
  assert.equal(retained.pdf_sha256, beforeMutation.hash);
  assert.deepEqual((await restartedReports.snapshotArtifact(retained)).buffer, beforeMutation.bytes, 'Source edits, archive/restore and a module restart never replace accepted snapshot PDF bytes.');
  const repeatedSnapshot = await restartedReports.createSnapshot({ user: owner, input, req: request() });
  assert.notEqual(repeatedSnapshot.snapshot_id, snapshot.id, 'A changed source revision creates a distinct snapshot rather than mutating the previous artifact.');
  const leaseInput = { ...input, type: 'summary' }, leaseId = crypto.randomUUID(), leaseReference = 'PRPT-SYNTHETIC-LEASE-20261013';
  const leaseConnection = await pool.getConnection();
  let leaseSource;
  try {
    await leaseConnection.beginTransaction();
    leaseSource = await restartedReports._test.loadSource(restartedReports._test.parseRequest(leaseInput), owner, leaseConnection);
    await leaseConnection.commit();
  } catch (error) { await leaseConnection.rollback(); throw error; }
  finally { leaseConnection.release(); }
  const leaseHash = restartedReports._test.sourceHash(leaseSource);
  const leaseKey = restartedReports._test.sourceHash({ user: owner.id, source_hash: leaseHash });
  const frozenLeaseDocument = JSON.stringify(restartedReports._test.documentData(leaseSource, leaseReference, new Date('2026-10-13T00:00:00Z')));
  await pool.query(`INSERT INTO procurement_report_snapshots(id,reference,request_key,created_by,report_type,source_kind,source_sha256,source_json,document_json,record_count,generation_status,claim_token,claim_expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'GENERATING',?,DATE_SUB(NOW(),INTERVAL 1 SECOND))`, [leaseId, leaseReference, leaseKey, owner.id, 'summary', 'entries', leaseHash, JSON.stringify(leaseSource), frozenLeaseDocument, leaseSource.records.length, crypto.randomUUID()]);
  const expiredLease = await restartedReports.getSnapshot({ user: owner, snapshotId: leaseId });
  await assert.rejects(() => restartedReports.snapshotArtifact(expiredLease), { code: 'PROCUREMENT_PDF_PENDING' });
  const recoveredLease = await restartedReports.createSnapshot({ user: owner, input: leaseInput, req: request() });
  assert.equal(recoveredLease.snapshot_id, leaseId, 'An expired generation lease reuses the frozen request identity.');
  assert.equal(recoveredLease.generation_status, 'VALIDATED');
  const completedLease = await restartedReports.getSnapshot({ user: owner, snapshotId: leaseId });
  assert.equal(completedLease.reference, leaseReference);
  assert.equal(completedLease.document_json, frozenLeaseDocument, 'Generation retry uses the original frozen document and reference.');
  assert.equal(completedLease.claim_token, null);
  assert.equal(completedLease.claim_expires_at, null);
  await validatePdf((await restartedReports.snapshotArtifact(completedLease)).buffer, { expectedText: [leaseReference, 'AUD 53.01'] });
  facts.push('real procurement request uniqueness, owner/all scope, competing edits, archive/restore history, 32-record filtered totals/full PDF, immutable snapshot dedup/restart and expired generation lease retry');
}

async function testProcurementImports() {
  const XLSX = require('xlsx');
  const extraction = require('../services/procurementImportExtractionService');
  const storage = require('../services/objectStorageService');
  const originalConfigured = storage.isConfigured;
  const originalProvider = process.env.OBJECT_STORAGE_PROVIDER;
  // This fresh local database proves the durable LONGBLOB path without touching
  // configured object storage. The isolated workflow fixture covers private S3.
  storage.isConfigured = () => false;
  delete process.env.OBJECT_STORAGE_PROVIDER;
  const owner = { id: 20, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const other = { id: 21, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'IMPORT_PROCUREMENT'] };
  const request = (key = null) => ({ ip: '127.0.0.1', id: 'disposable-procurement-import', get: (name) => String(name).toLowerCase() === 'idempotency-key' ? key : 'Synthetic import SQL fixture' });
  const fields = [...extraction.IMPORT_FIELDS];
  const values = (reference, description, quantity, price, notes = '') => ({ supplier_name: 'Synthetic imported supplier', reference, date: '2026-10-13', currency: 'AUD', description, quantity, unit: 'ea', unit_price: price, tax_rate: '0', notes, category: 'Materials', priority: 'HIGH', phase: 'Preparation' });
  const alpha = values('IMPORT-ALPHA', 'Imported Alpha fixture', '2', '3');
  const beta = values('IMPORT-BETA', 'Imported Beta fixture', '3', '4', 'Retain, this quoted CSV cell');
  const rejected = values('IMPORT-REJECTED', 'Correct this rejected source row', '0', '1');
  const csvCell = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const csv = Buffer.from([fields, ...[alpha, rejected, alpha, beta].map((row) => fields.map((field) => row[field] ?? ''))].map((row) => row.map(csvCell).join(',')).join('\r\n'));
  const workbook = XLSX.utils.book_new();
  const workbookValues = values('IMPORT-WORKBOOK', 'Imported workbook fixture', 1.005, 1);
  const sheet = XLSX.utils.aoa_to_sheet([fields, fields.map((field) => workbookValues[field] ?? '')]);
  sheet[XLSX.utils.encode_cell({ r: 1, c: fields.indexOf('unit_price') })].f = '1+0';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Reviewed quotes');
  const xlsx = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const malformedPdf = Buffer.from('%PDF-1.7\nThe original unparseable source must remain durable.');
  const originals = [
    ['procurement-source.csv', csv, 'text/csv'],
    ['procurement-source.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['unparseable-source.pdf', malformedPdf, 'application/pdf'],
    ['unsupported-source.exe', Buffer.from('This unsupported file is rejected before durable acceptance.'), 'application/octet-stream']
  ];
  const uploadFiles = async (sources = originals) => Promise.all(sources.map(async ([name, body, mime]) => ({ ...await fileFixture(name, body), mimetype: mime })));
  let imports;
  try {
    delete require.cache[require.resolve('../services/procurementImportService')];
    imports = require('../services/procurementImportService');
    const staged = await uploadFiles();
    const uploaded = await imports.createUpload({ user: owner, files: staged, req: request('mysql-import-same-request') });
    assert.equal(uploaded.files.length, 4);
    assert.equal(uploaded.counts.stored_files, 3);
    assert.equal(uploaded.counts.rejected_files, 1);
    assert.ok(staged.every((file) => !fs.existsSync(file.path)), 'Only durable bytes remain after the upload staging files are removed.');
    const replayed = await imports.createUpload({ user: owner, files: await uploadFiles(), req: request('mysql-import-same-request') });
    assert.equal(replayed.batch.id, uploaded.batch.id);
    assert.equal(replayed.existing, true);
    await assert.rejects(() => uploadFiles([['different-source.csv', Buffer.from('description,quantity\nChanged source,1'), 'text/csv']]).then((files) => imports.createUpload({ user: owner, files, req: request('mysql-import-same-request') })), { code: 'IDEMPOTENCY_CONFLICT' });
    const csvFile = uploaded.files.find((file) => file.name.endsWith('.csv'));
    const workbookFile = uploaded.files.find((file) => file.name.endsWith('.xlsx'));
    const failedFile = uploaded.files.find((file) => file.name.endsWith('.pdf'));
    for (const file of uploaded.files.filter((source) => source.durable)) {
      const original = originals.find(([name]) => name === file.name)[1];
      const stored = await imports.readSourceFile({ user: owner, fileId: file.id });
      assert.deepEqual(stored.buffer, original);
      assert.equal(stored.sha256, digest(original));
      await assert.rejects(() => imports.readSourceFile({ user: other, fileId: file.id }), { code: 'PROCUREMENT_RECORD_NOT_FOUND' });
    }
    delete require.cache[require.resolve('../services/procurementImportService')];
    imports = require('../services/procurementImportService');
    await imports.processPendingImports();
    let detail = await imports.getImport({ user: owner, id: uploaded.batch.id, query: { page_size: 100 } });
    assert.equal(detail.total, 5);
    assert.equal(detail.files.find((file) => file.id === failedFile.id).status, 'EXTRACTION_FAILED');
    assert.equal(detail.files.find((file) => file.id === failedFile.id).error_code, 'IMPORT_PDF_INVALID');
    assert.deepEqual((await imports.readSourceFile({ user: owner, fileId: failedFile.id })).buffer, malformedPdf);
    const mapping = Object.fromEntries(fields.map((field, index) => [field, index]));
    detail = await imports.previewImport({ user: owner, id: detail.batch.id, input: { expected_revision: detail.revision, file_id: csvFile.id, sheet_name: 'CSV', header_row: 1, mapping, classification: 'PLAN', date_order: 'ISO' }, req: request() });
    assert.equal(detail.counts.validated, 2);
    assert.equal(detail.counts.rejected, 1);
    assert.equal(detail.counts.duplicate, 1);
    const alphaRow = detail.rows.find((row) => row.values.reference === 'IMPORT-ALPHA' && row.status === 'VALIDATED');
    const rejectedRow = detail.rows.find((row) => row.status === 'REJECTED');
    const confirmation = { expected_revision: detail.revision, preview_token: detail.preview_token, row_ids: [alphaRow.id], reviewed_row_ids: [alphaRow.id] };
    const partial = await imports.commitImport({ user: owner, id: detail.batch.id, input: confirmation, req: request() });
    assert.equal(partial.batch.status, 'PARTIALLY_COMMITTED');
    assert.equal(partial.entries.length, 1);
    assert.equal(partial.entries[0].status, 'DRAFT');
    assert.equal(partial.entries[0].import_file_id, csvFile.id);
    assert.equal(partial.entries[0].import_row_id, alphaRow.id);
    const confirmationReplay = await imports.commitImport({ user: owner, id: detail.batch.id, input: confirmation, req: request() });
    assert.equal(confirmationReplay.existing, true);
    assert.equal(confirmationReplay.entries[0].id, partial.entries[0].id);
    await assert.rejects(() => imports.commitImport({ user: owner, id: detail.batch.id, input: { ...confirmation, row_ids: [rejectedRow.id], reviewed_row_ids: [rejectedRow.id] }, req: request() }), { code: 'CONFIRMATION_CONFLICT' });
    await assert.rejects(() => imports.getImport({ user: other, id: detail.batch.id }), { code: 'PROCUREMENT_RECORD_NOT_FOUND' });
    const correctedValues = { ...rejectedRow.values, quantity: '1', title: 'Explicitly corrected rejected source row', reference: 'IMPORT-CORRECTED' };
    detail = await imports.editImportRow({ user: owner, id: detail.batch.id, rowId: rejectedRow.id, input: { expected_revision: rejectedRow.revision, values: correctedValues, reviewed: true }, req: request() });
    await assert.rejects(() => imports.editImportRow({ user: owner, id: detail.batch.id, rowId: rejectedRow.id, input: { expected_revision: rejectedRow.revision, values: correctedValues, reviewed: true }, req: request() }), { code: 'REVISION_CONFLICT' });
    detail = await imports.previewImport({ user: owner, id: detail.batch.id, input: { expected_revision: detail.revision, file_id: workbookFile.id, sheet_name: 'Reviewed quotes', header_row: 1, mapping, classification: 'QUOTATION', date_order: 'ISO' }, req: request() });
    const formulaRow = detail.rows.find((row) => row.file_id === workbookFile.id);
    assert.equal(formulaRow.status, 'REVIEW_REQUIRED');
    assert.ok(formulaRow.warnings.some((warning) => warning.code === 'IMPORT_FORMULA_REVIEW_REQUIRED'));
    await assert.rejects(() => imports.commitImport({ user: owner, id: detail.batch.id, input: { expected_revision: detail.revision, preview_token: detail.preview_token, row_ids: [formulaRow.id] }, req: request() }), { code: 'IMPORT_REVIEW_REQUIRED' });
    const remaining = detail.rows.filter((row) => ['VALIDATED', 'REVIEW_REQUIRED'].includes(row.status));
    const completed = await imports.commitImport({ user: owner, id: detail.batch.id, input: { expected_revision: detail.revision, preview_token: detail.preview_token, row_ids: remaining.map((row) => row.id), reviewed_row_ids: remaining.map((row) => row.id) }, req: request() });
    assert.equal(completed.entries.length, 3);
    assert.equal(completed.counts.accepted, 4);
    assert.equal(completed.counts.duplicate, 1);
    assert.equal(completed.counts.rejected, 0);
    assert.equal(completed.counts.failed_files, 1);
    assert.equal(completed.entries.find((entry) => entry.reference === 'IMPORT-BETA').notes, beta.notes);
    const [[savedCount]] = await pool.query('SELECT COUNT(*) count FROM procurement_records WHERE import_batch_id=?', [detail.batch.id]);
    assert.equal(savedCount.count, 4);
    const report = await imports.readImportReport({ user: owner, batchId: detail.batch.id });
    assert.equal(report.files.length, 4);
    assert.equal(report.rows.length, 5);
    assert.equal(report.counts.accepted, 4);
    const repeatedUpload = await imports.createUpload({ user: owner, files: await uploadFiles([originals[0]]), req: request('mysql-new-upload-same-source') });
    assert.equal(repeatedUpload.files[0].duplicate_of_file_id, csvFile.id);
    await imports.processPendingImports();
    const duplicateDetail = await imports.getImport({ user: owner, id: repeatedUpload.batch.id, query: { page_size: 100 } });
    const duplicatePreview = await imports.previewImport({ user: owner, id: duplicateDetail.batch.id, input: { expected_revision: duplicateDetail.revision, file_id: repeatedUpload.files[0].id, header_row: 1, mapping, classification: 'PLAN', date_order: 'ISO' }, req: request() });
    assert.equal(duplicatePreview.counts.validated, 0, 'Repeated source rows already linked to this owner cannot silently create more drafts.');
    assert.equal(duplicatePreview.counts.duplicate, 3);
    const ownOther = await imports.createUpload({ user: other, files: await uploadFiles([originals[0]]), req: request('mysql-other-owner-same-source') });
    assert.equal(ownOther.files[0].duplicate_of_file_id, null, 'File deduplication never exposes another owner source identity.');
    assert.equal((await imports.listImports({ user: other, query: { page_size: 100 } })).total, 1);
    const failedBefore = await imports.getImport({ user: owner, id: uploaded.batch.id });
    await imports.retryExtraction({ user: owner, id: uploaded.batch.id, input: { expected_revision: failedBefore.revision, reason: 'Controlled retry of retained source parsing' }, req: request() });
    const deadline = Date.now() + 20000;
    for (;;) {
      const [[file]] = await pool.query('SELECT status,attempts FROM procurement_import_files WHERE id=?', [failedFile.id]);
      if (file.status === 'EXTRACTION_FAILED' && file.attempts === 1) break;
      assert.ok(Date.now() < deadline, 'Controlled extraction retry must settle without replacing the retained source.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual((await imports.readSourceFile({ user: owner, fileId: failedFile.id })).buffer, malformedPdf);
    const afterRetry = await imports.readImportReport({ user: owner, batchId: uploaded.batch.id });
    assert.equal(afterRetry.counts.accepted, 4);
    const outcome = await require('../services/procurementReportService').createSnapshot({ user: owner, input: { type: 'import-outcomes', source: 'entries', batch_id: uploaded.batch.id }, req: request() });
    const outcomeSnapshot = await require('../services/procurementReportService').getSnapshot({ user: owner, snapshotId: outcome.snapshot_id });
    const outcomePdf = await require('../services/procurementReportService').snapshotArtifact(outcomeSnapshot);
    await require('../services/documentPdfService').validatePdf(outcomePdf.buffer, { expectedText: ['PROCUREMENT IMPORT OUTCOMES', 'procurement-source.csv', 'unparseable-source.pdf', 'unsupported-source.exe'] });

    // Replace a committed extraction claim while its parser is paused. A stale
    // completion must not publish rows or clear the replacement worker lease.
    const claimBytes = Buffer.from('Description,Quantity,Unit price\nClaim fencing fixture,1,2\n');
    const claimedUpload = await imports.createUpload({ user: owner, files: await uploadFiles([['mysql-claim-fence.csv', claimBytes, 'text/csv']]), req: request('mysql-extraction-claim-fence') });
    const claimedId = claimedUpload.files[0].id;
    const originalExtract = extraction.extractImportFile;
    let arrived, release;
    const started = new Promise((resolve) => { arrived = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    extraction.extractImportFile = async function (file, options) {
      if (file.filename === 'mysql-claim-fence.csv') { arrived(); await gate; }
      return originalExtract(file, options);
    };
    try {
      const running = imports.processPendingImports();
      await Promise.race([started, running.then(() => assert.fail('The MySQL extraction fixture must claim its retained source.'))]);
      const [[activeClaim]] = await pool.query('SELECT status,processing_claim_token,attempts FROM procurement_import_files WHERE id=?', [claimedId]);
      assert.equal(activeClaim.status, 'EXTRACTING');
      assert.ok(activeClaim.processing_claim_token);
      assert.equal(activeClaim.attempts, 1);
      const replacementClaim = crypto.randomUUID();
      const [replaced] = await pool.query('UPDATE procurement_import_files SET processing_claim_token=? WHERE id=? AND processing_claim_token=?', [replacementClaim, claimedId, activeClaim.processing_claim_token]);
      assert.equal(replaced.affectedRows, 1);
      release(); await running;
      const [[preservedClaim]] = await pool.query('SELECT status,processing_claim_token FROM procurement_import_files WHERE id=?', [claimedId]);
      assert.equal(preservedClaim.status, 'EXTRACTING');
      assert.equal(preservedClaim.processing_claim_token, replacementClaim);
      const [[beforeReclaim]] = await pool.query('SELECT COUNT(*) count FROM procurement_import_rows WHERE file_id=?', [claimedId]);
      assert.equal(beforeReclaim.count, 0, 'A stale worker cannot insert source rows after losing its claim.');
      extraction.extractImportFile = originalExtract;
      await pool.query('UPDATE procurement_import_files SET processing_expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=? AND processing_claim_token=?', [claimedId, replacementClaim]);
      await imports.processPendingImports();
      const [[reclaimed]] = await pool.query('SELECT status,processing_claim_token,attempts FROM procurement_import_files WHERE id=?', [claimedId]);
      assert.equal(reclaimed.status, 'EXTRACTED');
      assert.equal(reclaimed.processing_claim_token, null);
      assert.equal(reclaimed.attempts, 2);
      const [[retainedRows]] = await pool.query('SELECT COUNT(*) count FROM procurement_import_rows WHERE file_id=?', [claimedId]);
      assert.equal(retainedRows.count, 1);
      assert.deepEqual((await imports.readSourceFile({ user: owner, fileId: claimedId })).buffer, claimBytes);
    } finally {
      release(); extraction.extractImportFile = originalExtract;
    }
    assert.deepEqual(await historicalState(), historicalRows, 'Imports and reports never write historical original ledgers, stock, RFQs or retired snapshots.');
    facts.push('real CSV/XLSX source persistence/restart, every file outcome, exact source bytes and owner isolation, mapped validation/duplicates/formula review, partial commit receipts/rejected-row correction, repeated upload dedup, controlled retry and atomic extraction claim fencing/reclaim');
  } finally {
    await imports?.stopProcurementImportWorker?.();
    storage.isConfigured = originalConfigured;
    if (originalProvider === undefined) delete process.env.OBJECT_STORAGE_PROVIDER;
    else process.env.OBJECT_STORAGE_PROVIDER = originalProvider;
  }
}

async function main() {
  await prepareFixtures();
  await initializeRetainedSchemas();
  await testAudit();
  await testIdentityAndProfile();
  await testDocuments();
  await testQueue();
  await testWeeklyDelivery();
  await testProcurementRecordsAndSnapshots();
  await testProcurementImports();
  await testArchivedRetention();
  assert.deepEqual(await historicalState(), historicalRows, 'All restored workflows preserve original and retired historical records.');
  console.log(`MYSQL_RETAINED_OK: ${facts.join('; ')}.`);
}

async function testArchivedRetention() {
  // All DDL/data remain inside the explicitly guarded, fresh disposable database.
  const { splitMigrationSql } = require('../services/migrationRunner');
  const workerSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260912_wave_b2_background_job_safety.sql'), 'utf8');
  for (const sql of splitMigrationSql(workerSql)) await pool.query(sql);
  const run = crypto.randomUUID();
  await pool.query(`INSERT INTO background_job_runs(run_uuid,job_key,lease_token,started_at,completed_at,status)
    VALUES(?, 'finance_statement_import', ?, '2000-01-01', '2000-01-01', 'COMPLETED')`, [run, crypto.randomUUID()]);
  await pool.query(`INSERT INTO background_job_failures(run_uuid,job_key,attempt,error_code,error_summary,failed_at)
    VALUES(?, 'finance_statement_import', 1, 'ARCHIVED', 'Historical trace to preserve', '2000-01-01')`, [run]);
  await pool.query(`INSERT INTO background_job_dead_letters(run_uuid,job_key,attempt,error_code,error_summary,status,resolved_at,created_at)
    VALUES(?, 'finance_statement_import', 1, 'ARCHIVED', 'Historical trace to preserve', 'RESOLVED', '2000-01-01', '2000-01-01')`, [run]);
  await pool.query(`INSERT INTO email_queue(to_json,subject,related_module,status,sent_at,created_at)
    VALUES('["archive@example.invalid"]','Historical report mail','finance','SENT','2000-01-01','2000-01-01'),
    ('["archive@example.invalid"]','Unclassified historical mail',NULL,'SENT','2000-01-01','2000-01-01')`);
  await pool.query(`INSERT INTO email_logs(recipients,subject,related_module,status,created_at)
    VALUES('archive@example.invalid','Historical report log','finance','SENT','2000-01-01'),
    ('archive@example.invalid','Unclassified historical log',NULL,'SENT','2000-01-01')`);
  await pool.query(`INSERT INTO security_events(event_type,result,metadata_json,created_at)
    VALUES('BANK_DETAILS_CHANGED','SUCCESS','{"module":"finance","fixture":true}','2000-01-01'),
    ('STEP_UP_REQUIRED','DENIED','{"action":"APPROVE_PAYMENT","fixture":true}','2000-01-01')`);
  const archivedState = async () => {
    const rows = {};
    for (const table of ['background_job_runs','background_job_failures','background_job_dead_letters']) {
      rows[table] = (await pool.query(`SELECT * FROM ${table} WHERE job_key='finance_statement_import' ORDER BY run_uuid`))[0];
    }
    rows.queue = (await pool.query("SELECT * FROM email_queue WHERE related_module='finance' OR related_module IS NULL ORDER BY id"))[0];
    rows.logs = (await pool.query("SELECT * FROM email_logs WHERE related_module='finance' OR related_module IS NULL ORDER BY id"))[0];
    rows.events = (await pool.query("SELECT * FROM security_events WHERE event_type='BANK_DETAILS_CHANGED' OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.action'))='APPROVE_PAYMENT' ORDER BY id"))[0];
    return digest(rows);
  };
  const before = await archivedState();
  const { BackgroundJobStore } = require('../services/backgroundJobStore');
  const store = new BackgroundJobStore(pool);
  await store.initialize(['email_queue_delivery']);
  await store.pruneTelemetry({ aggressive: true, jobKeys: ['email_queue_delivery'] });
  assert.equal(await archivedState(), before, 'Retained worker startup/retention never changes archived job rows.');
  await require('../services/databaseCapacityRecoveryService').recoverDatabaseCapacity({ force: true });
  await require('../services/securityEventRetentionService').pruneSecurityEvents();
  assert.equal(await archivedState(), before, 'Capacity recovery and security retention preserve archived mail, jobs and events.');
  assert.deepEqual(await store.listDeadLetters(1, ['email_queue_delivery']), [], 'Archived failures are absent from retained pages.');
  facts.push('real SQL worker startup, capacity recovery and retention preserve old Finance/unclassified mail, jobs and security events');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (originalSendMail) require('../services/emailService').sendMail = originalSendMail;
  await fs.promises.rm(fixtureDirectory, { recursive: true, force: true });
  await pool.end();
});
