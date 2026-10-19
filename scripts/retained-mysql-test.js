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
    set(name,value){this.setHeader(name,value);return this;},
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
    .concat([['../services/documentDeliveryService', 'ensureDocumentDeliverySchema'], ['../services/weeklyTimesheetDeliverySchema', 'ensureWeeklyTimesheetDeliverySchema'], ['../services/attendanceMobileSchema', 'ensureAttendanceMobileSchema']]);
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
    'mobile_number', 'timesheet_delivery_email', 'profile_photo_mime', 'profile_photo_size', 'profile_photo_updated_at', 'profile_photo_revision',
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
  // Resolve only the synthetic missing-recipient fixture after the normal window.
  await pool.query("UPDATE users SET timesheet_delivery_email='weekly-33@example.invalid' WHERE id=33");
  const recoveryNow=DateTime.fromJSDate(scheduledNow).plus({hours:3}).toJSDate();
  assert.equal(policy.scheduleWindow(recoveryNow,policy.configuration(process.env)).eligible,false);
  const recovered=await Promise.all([scheduler.queueClosedWeekTimesheets({...options,now:recoveryNow}),scheduler.queueClosedWeekTimesheets({...options,now:recoveryNow})]);
  assert.equal(recovered.reduce((sum,result)=>sum+result.queued,0),1);
  const [[recoveredDelivery]]=await pool.query('SELECT * FROM weekly_timesheet_deliveries WHERE user_id=33 AND period_start=?',[period.start]);
  assert.equal(recoveredDelivery.generation_attempts,1,'Generation budget is persisted under the actual employee/delivery lock.');
  assert.equal(recoveredDelivery.recipient,'weekly-33@example.invalid');
  const [[recoveryAudit]]=await pool.query("SELECT COUNT(*) total FROM audit_logs WHERE action='WEEKLY_TIMESHEET_RECOVERY_QUEUED' AND record_id=?",[String(recoveredDelivery.id)]);
  assert.equal(Number(recoveryAudit.total),1);
  await makeWeeklyFixtureDue(recoveredDelivery.email_queue_id);
  assert.deepEqual(await queue.processEmailQueue(50),[{id:recoveredDelivery.email_queue_id,status:'SENT',provider_accepted:true,recipient_verified:false}]);
  const reconciled=await require('../services/weeklyTimesheetReconciliation').reconcileWeek({db:pool,now:recoveryNow,env:process.env,actor:{id:20,role:'admin'}});
  const reconciledStaff=reconciled.outcomes.find(entry=>entry.user_id===33);
  assert.equal(reconciledStaff.status,'PROVIDER_ACCEPTED');assert.equal(reconciledStaff.recipient_verified,false);assert.equal(reconciledStaff.pdf.status,'VALIDATED');
  facts.push('real InnoDB bounded missed-window recovery after designated-address correction; concurrent workers queue once; persisted generation budget and one audit; reconciled PDF/queue/provider states without claiming receipt');
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

async function testInvoicePaymentReview(){
 const controller=require('../controllers/invoiceController'),admin={id:1,role:'admin'},id=840001;
 await pool.query("INSERT INTO invoices(id,invoice_no,customer_name,customer_email,quantity,unit_price,gst_rate,total,status,deleted,document_revision) VALUES(?,'INVOICE-REVIEW-FIXTURE','Synthetic review customer','invoice-review@example.invalid',1,2463.73,10,2710.10,'paid',0,1)",[id]);
 await pool.query('INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES(?,?,?,?,?)',[id,'Disposable reviewed invoice fixture',1,2463.73,2463.73]);
 await pool.query("INSERT INTO invoice_activity(invoice_id,action_type,notes) VALUES(?,'paid','Invoice marked as paid')",[id]);
 const read=async()=>{const res=response();await controller.getInvoiceDetails({params:{id},query:{},user:admin},res);assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.body;};
 const before=digest((await pool.query('SELECT * FROM invoices WHERE id=?',[id]))[0]),view=await read();assert.equal(view.invoice.paid_amount,null);assert.equal(view.invoice.balance_due,null);assert.equal(view.summary.tax_amount,'246.37');assert.equal(view.summary.subtotal,'2463.73');assert.equal(view.summary.payment_state,'review_required');assert.equal(view.payments.length,0);assert.equal(digest((await pool.query('SELECT * FROM invoices WHERE id=?',[id]))[0]),before,'Viewing cannot rewrite historical claims');
 const list=response();await controller.getInvoices({query:{search:'INVOICE-REVIEW-FIXTURE'},user:admin},list);assert.equal(list.body.total,1);assert.equal(list.body.summary.paid_value,null);assert.equal(list.body.summary.balance_value,null);assert.equal(list.body.invoices[0].paid_amount,null);
 const call=async(body,key,user=admin)=>{const res=response();await controller.reviewInvoicePayments({params:{id},body,user,get:name=>name==='Idempotency-Key'?key:undefined},res);return res;};
 const correction={decision:'confirm_register',reason:'Verified source record confirms the register is complete and no payment was received.',evidence_reference:'DISPOSABLE-UNPAID-RECORD',acknowledged:true,expected_version:view.payment_version};
 assert.equal((await call(correction,'invoice-review-denied',{id:30,role:'viewer'})).statusCode,403);
 assert.equal((await call({...correction,acknowledged:false},'invoice-review-unconfirmed')).statusCode,422);
 const results=await Promise.all([call(correction,'invoice-review-request'),call(correction,'invoice-review-request')]);assert(results.every(r=>r.statusCode===200&&r.body.confirmed));assert.equal(results.filter(r=>r.body.existing).length,1);
 const reviewed=await read();assert.equal(reviewed.invoice.status,'draft');assert.equal(reviewed.summary.payment_state,'unpaid');assert.equal(reviewed.summary.paid_amount,'0.00');assert.equal(reviewed.summary.balance_due,'2710.10');assert.equal(reviewed.payments.length,0,'Confirming the register must not manufacture payments');
 const [[audit]]=await pool.query("SELECT COUNT(*) count FROM invoice_activity WHERE invoice_id=? AND action_type='payment_review_resolved'",[id]);assert.equal(Number(audit.count),1);
 assert.equal((await call(correction,'invoice-review-stale')).statusCode,409);assert.equal((await call({...correction,reason:'Different evidence using the original identity'},'invoice-review-request')).statusCode,409);
 await pool.query("UPDATE invoices SET status='paid' WHERE id=?",[id]);const paymentView=await read(),payment={...correction,decision:'record_payment',reason:'Verified the complete source payment receipt against this invoice.',evidence_reference:'DISPOSABLE-RECEIPT',amount:'2710.10',payment_date:'2026-10-14',method:'Verified source receipt',reference:'DISPOSABLE-PAID-RECEIPT',expected_version:paymentView.payment_version};
 const paidResults=await Promise.all([call(payment,'invoice-review-paid'),call(payment,'invoice-review-paid')]);assert(paidResults.every(r=>r.body.confirmed));assert.equal(paidResults.filter(r=>r.body.existing).length,1);const paid=await read();assert.equal(paid.payments.length,1);assert.equal(paid.summary.paid_amount,'2710.10');assert.equal(paid.summary.balance_due,'0.00');assert.equal(paid.invoice.status,'paid');
 const pdf=await controller._test.loadInvoiceDocument(id,admin);assert.equal(pdf.document_version,paid.document_version);assert(pdf.data.totals.some(t=>t.label==='Paid amount'&&t.value==='AUD 2,710.10'));
 const voidResponse=response();await controller.deleteInvoicePayment({body:{invoice_id:id,payment_id:paid.payments[0].id,reason:'Verified correction: source receipt was reversed.'},user:admin},voidResponse);assert.equal(voidResponse.statusCode,200);const reversed=await read();assert.equal(reversed.payments.length,1);assert(reversed.payments[0].voided_at);assert.equal(reversed.summary.paid_amount,'0.00');assert.equal(reversed.summary.balance_due,'2710.10');
 await pool.query("INSERT INTO invoice_activity(invoice_id,action_type,notes) VALUES(?,'sent','Disposable confirmed delivery history')",[id]);
 await pool.query("UPDATE invoices SET status='paid' WHERE id=?",[id]);
 const lifecycleReview=await read();const lifecycleResult=await call({...correction,expected_version:lifecycleReview.payment_version},'invoice-review-lifecycle');assert.equal(lifecycleResult.statusCode,200);assert.equal((await read()).invoice.status,'sent','Evidence-based review preserves the existing document lifecycle');
 facts.push('invoice SQL projection, detail and PDF agree; legacy settlement remains unknown without writes; authorised evidenced review is locked/audited/idempotent under concurrent requests; no synthetic receipt on register confirmation; real receipt and historical reversal preserve amounts/history; evidenced sent lifecycle survives payment review');
}

async function main() {
  await prepareFixtures();
  await initializeRetainedSchemas();
  await testAudit();
  await testInvoicePaymentReview();
  await testIdentityAndProfile();
  await testDocuments();
  await testQueue();
  await testWeeklyDelivery();
  await testProcurementRecordsAndSnapshots();
  await testProcurementImports();
  await prepareMobileUsers();
  await testDurableProfilePhotos();
  await testDurableNotifications();
  await testDurableAttendanceActions();
  await testAttendanceDisplayLinks();
  await testAttendanceCorrections();
  await testAttendancePeriodActionGuards();
  await testVerifiedAttendanceTotals();
  await testOriginalGoodsReceiptNotifications();
  await testMixedCollationNotificationOwnership();
  await testArchivedRetention();
  await testCheckoutSummaryOptions();
  assert.deepEqual(await historicalState(), historicalRows, 'All restored workflows preserve original and retired historical records.');
  console.log(`MYSQL_RETAINED_OK: ${facts.join('; ')}.`);
}

const mobileUsers = {
  staff: { id: 131, role: 'staff', permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET'] },
  other: { id: 132, role: 'staff', permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_JOBS', 'VIEW_OWN_TIMESHEET'] },
  manager: { id: 133, role: 'supervisor', permissions: ['VIEW_ATTENDANCE', 'VIEW_TEAM_TIMESHEET', 'APPROVE_TEAM_TIMESHEET'] },
  approver: { id: 134, role: 'integration_fixture', permissions: ['VIEW_ATTENDANCE', 'EDIT_ATTENDANCE', 'APPROVE_ALL_TIMESHEETS'] },
  outsideManager: { id: 135, role: 'supervisor', permissions: ['VIEW_ATTENDANCE', 'VIEW_TEAM_TIMESHEET', 'APPROVE_TEAM_TIMESHEET'] }
};
async function prepareMobileUsers() {
  for (const [label, user] of Object.entries(mobileUsers)) {
    await pool.query('INSERT INTO users(id,name,username,email,password,role,permissions,active,department,manager_id) VALUES(?,?,?,?,?,?,?,1,?,?)',
      [user.id, `Synthetic ${label} SQL fixture`, `synthetic-${label}-${user.id}`, `synthetic-${label}@example.invalid`, 'not-a-login-hash', user.role, JSON.stringify(user.permissions), 'Synthetic verification team', label === 'staff' ? mobileUsers.manager.id : label === 'other' ? mobileUsers.outsideManager.id : null]);
  }
}
async function testDurableProfilePhotos() {
  const storage = require('../services/objectStorageService'), configured = storage.isConfigured;
  const provider = process.env.OBJECT_STORAGE_PROVIDER;
  storage.isConfigured = () => false; delete process.env.OBJECT_STORAGE_PROVIDER;
  let photos = require('../services/profilePhotoService');
  const canvas = require('@napi-rs/canvas').createCanvas(128, 96), drawing = canvas.getContext('2d');
  drawing.fillStyle = '#165b82'; drawing.fillRect(0, 0, 128, 96);
  drawing.fillStyle = '#e7b554'; drawing.fillRect(64, 0, 64, 96);
  const original = { buffer: await canvas.encode('png'), mimetype: 'image/png', originalname: 'synthetic-avatar.png' };
  const req = { user: mobileUsers.staff, params: { id: mobileUsers.other.id }, query: { user_id: mobileUsers.other.id }, ip: '127.0.0.1', requestId: 'synthetic-photo-sql', get: () => 'Synthetic photo SQL fixture' };
  try {
    await photos.ensureProfilePhotoSchema();
    delete require.cache[require.resolve('../services/profilePhotoService')]; photos = require('../services/profilePhotoService');
    await photos.ensureProfilePhotoSchema();
    const first = await photos.saveProfilePhoto(mobileUsers.staff.id, original, req, { x: 1, y: 0.5, zoom: 1.25 });
    assert.equal(first.mime, 'image/jpeg'); assert.equal(first.width, 512); assert.equal(first.height, 512);
    const [[persisted]] = await pool.query('SELECT profile_photo,profile_photo_sha256,profile_photo_object_key,profile_photo_width,profile_photo_height FROM user_profiles WHERE user_id=?', [mobileUsers.staff.id]);
    assert.deepEqual(persisted.profile_photo, first.buffer); assert.equal(persisted.profile_photo_sha256, first.sha256);
    assert.equal(persisted.profile_photo_object_key, null); assert.equal(persisted.profile_photo_width, 512); assert.equal(persisted.profile_photo_height, 512);
    const [[beforeRepeat]] = await pool.query("SELECT COUNT(*) count FROM audit_logs WHERE action='PROFILE_PHOTO_UPDATED' AND actor_id=?", [mobileUsers.staff.id]);
    const repeated = await photos.saveProfilePhoto(mobileUsers.staff.id, original, req, { x: 1, y: 0.5, zoom: 1.25 });
    assert.equal(repeated.unchanged, true); assert.equal(repeated.sha256, first.sha256);
    const [[afterRepeat]] = await pool.query("SELECT COUNT(*) count FROM audit_logs WHERE action='PROFILE_PHOTO_UPDATED' AND actor_id=?", [mobileUsers.staff.id]);
    assert.equal(afterRepeat.count, beforeRepeat.count, 'Identical normalized bytes do not create repeated photo revisions.');
    delete require.cache[require.resolve('../services/profilePhotoService')]; photos = require('../services/profilePhotoService');
    assert.deepEqual((await photos.getProfilePhoto(mobileUsers.staff.id)).buffer, first.buffer, 'A service restart reads exact durable normalized photo bytes.');
    assert.equal(await photos.getProfilePhoto(mobileUsers.other.id), null, 'Switching authenticated account never reads the previous owner photo.');
    const profile = require('../controllers/profileController'), own = response();
    await profile.getMyProfilePhoto(req, own); assert.equal(own.statusCode, 200); assert.deepEqual(own.body, first.buffer);
    assert.equal(own.headers['cache-control'], 'private, no-store'); assert.equal(own.headers.vary, 'Cookie, Authorization');
    const denied = response(); await profile.getStaffProfilePhoto({ ...req, user: mobileUsers.other, params: { id: mobileUsers.staff.id } }, denied);
    assert.equal(denied.statusCode, 404);
    const teammate = response(); await profile.getStaffProfilePhoto({ ...req, user: mobileUsers.manager, params: { id: mobileUsers.staff.id } }, teammate);
    assert.equal(teammate.statusCode, 200); assert.deepEqual(teammate.body, first.buffer);
    const outside = response(); await profile.getStaffProfilePhoto({ ...req, user: mobileUsers.outsideManager, params: { id: mobileUsers.staff.id } }, outside);
    assert.equal(outside.statusCode, 404, 'Team photo access uses the saved manager relationship.');
    await assert.rejects(() => photos.saveProfilePhoto(mobileUsers.staff.id, { buffer: Buffer.from('not an image'), mimetype: 'image/png' }, req), { code: 'PROFILE_PHOTO_SIGNATURE_INVALID' });
    await assert.rejects(() => photos.saveProfilePhoto(mobileUsers.staff.id, original, req, { zoom: 4 }), { code: 'PROFILE_PHOTO_CROP_INVALID' });
    process.env.OBJECT_STORAGE_PROVIDER = 'synthetic-incomplete-provider';
    await assert.rejects(() => photos.saveProfilePhoto(mobileUsers.staff.id, original, req, { x: 0 }), { code: 'PROFILE_PHOTO_STORAGE_UNAVAILABLE' });
    delete process.env.OBJECT_STORAGE_PROVIDER;
    assert.deepEqual((await photos.getProfilePhoto(mobileUsers.staff.id)).buffer, first.buffer, 'Invalid photos/crops and unavailable selected storage preserve the saved photo.');
    await pool.query('UPDATE user_profiles SET profile_photo=? WHERE user_id=?', [Buffer.from('synthetic corrupt stored photo'), mobileUsers.staff.id]);
    try { await assert.rejects(() => photos.getProfilePhoto(mobileUsers.staff.id), { code: 'PROFILE_PHOTO_INTEGRITY_FAILED' }); }
    finally { await pool.query('UPDATE user_profiles SET profile_photo=? WHERE user_id=?', [first.buffer, mobileUsers.staff.id]); }
    await photos.removeProfilePhoto(mobileUsers.staff.id, req);
    assert.equal(await photos.getProfilePhoto(mobileUsers.staff.id), null);
    const [[removed]] = await pool.query('SELECT profile_photo,profile_photo_sha256,profile_photo_object_key FROM user_profiles WHERE user_id=?', [mobileUsers.staff.id]);
    assert.deepEqual(removed, { profile_photo: null, profile_photo_sha256: null, profile_photo_object_key: null });
    assert.equal((await photos.removeProfilePhoto(mobileUsers.staff.id, req)).unchanged, true);
    assert.deepEqual(await historicalState(), historicalRows);
    facts.push('durable normalized profile photo bytes/restart/idempotency, private no-store response, account/team isolation, failed validation/storage preservation and retained owner-only removal');
  } finally {
    storage.isConfigured = configured;
    if (provider === undefined) delete process.env.OBJECT_STORAGE_PROVIDER; else process.env.OBJECT_STORAGE_PROVIDER = provider;
  }
}

async function testDurableNotifications() {
  const service = require('../services/notificationService'), controller = require('../controllers/notificationController');
  const user = mobileUsers.staff, other = mobileUsers.other;
  const event = { userId: user.id, type: 'synthetic_verification', title: 'Synthetic durable notification fixture', message: 'A synthetic supported-system event.', category: 'SYSTEM', linkedModule: 'SYSTEM', dedupeKey: 'synthetic-atomic-event-1', actionUrl: null };
  const ids = await Promise.all([service.createNotification(pool, event), service.createNotification(pool, event)]);
  assert.equal(Number(ids[0]), Number(ids[1]), 'Concurrent event delivery retains one recipient notification.');
  const otherId = await service.createNotification(pool, { ...event, userId: other.id });
  assert.notEqual(Number(otherId), Number(ids[0]), 'The same event belongs independently to each recipient.');
  const req = { user, params: {}, query: { page: 1, limit: 30 }, body: {}, ip: '127.0.0.1', get: () => 'Synthetic notification SQL fixture' };
  const list = response(); await controller.list(req, list); assert.equal(list.statusCode, 200);
  assert.ok(list.body.notifications.some(item => Number(item.id) === Number(ids[0])));
  assert.ok(list.body.notifications.every(item => Number(item.id) !== Number(otherId)));
  const unreadBefore = response(); await controller.unreadCount(req, unreadBefore); assert.equal(unreadBefore.body.unread, 1);
  const denied = response(); await controller.markRead({ ...req, params: { id: otherId } }, denied); assert.equal(denied.statusCode, 404);
  const read = response(); await controller.markRead({ ...req, params: { id: ids[0] } }, read); assert.equal(read.statusCode, 200);
  delete require.cache[require.resolve('../controllers/notificationController')];
  const restarted = require('../controllers/notificationController'), unreadAfter = response(); await restarted.unreadCount(req, unreadAfter);
  assert.equal(unreadAfter.body.unread, 0, 'Read state survives a controller restart.');
  const [[otherRead]] = await pool.query('SELECT is_read FROM notifications WHERE id=?', [otherId]); assert.equal(otherRead.is_read, 0);
  const all = response(); await restarted.markAllRead(req, all); assert.equal(all.statusCode, 200);
  const [[otherStillUnread]] = await pool.query('SELECT is_read FROM notifications WHERE id=?', [otherId]); assert.equal(otherStillUnread.is_read, 0);
  const [legacyRetired] = await pool.query("INSERT INTO notifications(user_id,type,category,title,message,linked_module,action_url) VALUES(?,'synthetic_legacy','SYSTEM','Synthetic legacy Banking notice','Preserved legacy notice bytes','BANKING','/banking')", [user.id]);
  const invoiceNotice = await service.createNotification(pool, { ...event, category: 'FINANCE', linkedModule: 'INVOICE', linkedRecordId: 1, actionUrl: '/dashboard?view=invoices', dedupeKey: 'synthetic-original-invoice-notice' });
  const [[beforeHidden]] = await pool.query('SELECT * FROM notifications WHERE id=?', [legacyRetired.insertId]);
  const hiddenCount = response(); await restarted.unreadCount(req, hiddenCount); assert.equal(hiddenCount.body.unread, 0, 'Retired and unsupported-account module notices never enter the unread badge.');
  const hiddenRead = response(); await restarted.markRead({ ...req, params: { id: legacyRetired.insertId } }, hiddenRead); assert.equal(hiddenRead.statusCode, 404);
  const hiddenAll = response(); await restarted.markAllRead(req, hiddenAll); assert.equal(hiddenAll.statusCode, 200);
  const [[afterHidden]] = await pool.query('SELECT * FROM notifications WHERE id=?', [legacyRetired.insertId]); assert.deepEqual(afterHidden, beforeHidden, 'Hidden historical notifications are preserved rather than rewritten by read-all.');
  const [[originalInvoiceCategory]] = await pool.query('SELECT category,linked_module,is_read FROM notifications WHERE id=?', [invoiceNotice]);
  assert.deepEqual(originalInvoiceCategory, { category: 'FINANCE', linked_module: 'INVOICE', is_read: 0 }, 'Original invoice notification categories remain stored while the recipient lacks invoice access.');
  for (const target of ['/banking', '/dashboard?view=erp', '/dashboard?view=personal-finance', '//other.invalid/path', 'javascript:alert(1)']) assert.equal(service.normaliseActionUrl(target), null);
  assert.equal(service.normaliseActionUrl('/portal/staff?view=tasks'), '/portal/staff?view=tasks');
  assert.deepEqual(await historicalState(), historicalRows);
  facts.push('actual notification recipient/event uniqueness, durable read/unread totals/restart, owner-only read-all and retained-link sanitization');
}

async function testAttendanceDisplayLinks() {
  const displays = require('../services/attendanceDisplayService'), actions = require('../services/attendanceActionService');
  const daily = require('../services/attendanceDailyService'), qr = require('../services/attendanceQrService');
  const user = mobileUsers.approver, req = { ip: '127.0.0.1', get: () => 'Disposable display SQL fixture' };
  const input = { request_id: crypto.randomUUID(), label: 'SQL fixture kiosk' };
  const issued = await displays.create({ user, input, req });
  const credential = new URL(issued.url).hash.slice('#display='.length);
  const replay = await displays.create({ user, input, req });
  assert.equal(replay.display.id, issued.display.id); assert.equal(replay.url, undefined);
  const [[stored]] = await pool.query('SELECT * FROM attendance_display_links WHERE id=?', [issued.display.id]);
  assert.equal(stored.credential_hash, crypto.createHash('sha256').update(credential).digest('hex'));
  assert.ok(!JSON.stringify((await displays.list()).links).includes(stored.credential_hash));
  const now = new Date('2026-10-13T22:00:00Z'), code = await displays.current({ credential, now });
  for (const id of [181,182]) {
    const staff = { id, role: 'staff', permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_TIMESHEET'] };
    await pool.query('INSERT INTO users(id,name,username,email,password,role,permissions,active) VALUES(?,?,?,?,?,?,?,1)', [id, 'Synthetic QR SQL staff '+id, 'synthetic-display-'+id, 'display-'+id+'@example.invalid', 'not-a-login-hash', staff.role, JSON.stringify(staff.permissions)]);
    const proof = await actions.resolveQr({ user: staff, input: { action: 'CHECK_IN', token: code.qr_data }, now });
    const punch = { action: 'CHECK_IN', request_id: crypto.randomUUID(), qr_proof: proof.qr_proof };
    const receipts = await Promise.all([0,1].map(() => actions.performAction({ user: staff, input: punch, req, now })));
    assert.equal(receipts[0].attendance_id, receipts[1].attendance_id);
    let state = await daily.readToday({ user: staff, now }); assert.equal(state.status, 'WORKING'); assert.equal(state.active_attendance.user_id, id);
    const later = new Date(now.getTime()+3600000), next = await displays.current({ credential, now: later });
    const out = await actions.resolveQr({ user: staff, input: { action: 'CHECK_OUT', attendance_id: receipts[0].attendance_id, token: next.qr_data }, now: later });
    await actions.performAction({ user: staff, input: { action: 'CHECK_OUT', attendance_id: receipts[0].attendance_id, request_id: crypto.randomUUID(), qr_proof: out.qr_proof }, req, now: later });
    state = await daily.readToday({ user: staff, now: later }); assert.notEqual(state.status, 'WORKING'); assert.equal(state.active_attendance, null);
    const [[saved]] = await pool.query('SELECT user_id,total_minutes,clock_out FROM staff_attendance WHERE id=?', [receipts[0].attendance_id]); assert.equal(saved.user_id, id); assert.equal(saved.total_minutes, 60); assert.ok(saved.clock_out);
  }
  assert.throws(() => qr.validateSiteToken(code.qr_data, new Date(code.expires_at)), { code: 'ATTENDANCE_QR_EXPIRED' });
  const replacement = await displays.create({ user, replaceId: issued.display.id, input: { request_id: crypto.randomUUID(), expected_revision: 1, label: 'SQL replacement', reason: 'Disposable fixture replacement' }, req });
  await assert.rejects(() => displays.current({ credential }), { statusCode: 403 });
  const nextKey = new URL(replacement.url).hash.slice('#display='.length); await displays.current({ credential: nextKey });
  const revoke = { request_id: crypto.randomUUID(), expected_revision: 1, reason: 'Disposable fixture revocation' };
  await displays.revoke({ user, id: replacement.display.id, input: revoke, req });
  assert.equal((await displays.revoke({ user, id: replacement.display.id, input: revoke, req })).existing, true);
  await assert.rejects(() => displays.current({ credential: nextKey }), { statusCode: 403 });
  const [audits] = await pool.query("SELECT * FROM audit_logs WHERE record_type='attendance_display_link'"); assert.ok(audits.length>=4); assert.ok(!JSON.stringify(audits).includes(credential));
  facts.push('real InnoDB display issuance/replay, hashed credential, audited replacement/revocation; two staff share one QR with concurrent idempotent punches, correct Working identity, persisted checkout and expiry rejection');
}

async function testDurableAttendanceActions() {
  const user = mobileUsers.staff, other = mobileUsers.other;
  let actions = require('../services/attendanceActionService');
  const daily = require('../services/attendanceDailyService'), qr = require('../services/attendanceQrService');
  const schema = '../services/attendanceMobileSchema';
  await require(schema).ensureAttendanceMobileSchema();
  delete require.cache[require.resolve(schema)]; await require(schema).ensureAttendanceMobileSchema();
  const req = { user, ip: '127.0.0.1', id: 'synthetic-attendance-sql', get: () => 'Synthetic attendance SQL fixture' };
  const start = new Date('2026-10-03T15:30:00Z'); // Sydney 01:30 before spring DST.
  async function proof(action, attendanceId, now) {
    return (await actions.resolveQr({ user, input: { action, attendance_id: attendanceId, token: qr.createSiteToken(now).token }, now })).qr_proof;
  }
  const checkInId = crypto.randomUUID(), scan = await proof('CHECK_IN', null, start);
  const input = { action: 'CHECK_IN', request_id: checkInId, qr_proof: scan, clock_in: '2099-01-01T00:00:00Z', timestamp: '1900-01-01T00:00:00Z' };
  const concurrent = await Promise.all([actions.performAction({ user, input, req, now: start }), actions.performAction({ user, input, req, now: start })]);
  assert.equal(concurrent[0].attendance_id, concurrent[1].attendance_id);
  const committedState=await daily.readToday({user,now:start});
  assert.equal(committedState.status,'WORKING');assert.equal(committedState.profile.id,user.id);assert.equal(committedState.active_attendance.user_id,user.id);
  assert.equal(committedState.active_attendance.id,concurrent[0].attendance_id);
  assert.equal(concurrent.filter(result => result.existing).length, 1);
  const attendanceId = concurrent[0].attendance_id;
  assert.equal(concurrent[0].attendance.clock_in, '2026-10-03T15:30:00.000Z', 'Device-supplied clocks cannot replace server UTC.');
  assert.equal(concurrent[0].attendance.work_date, '2026-10-04');
  const separateDevice = await actions.performAction({ user, input: { ...input, request_id: crypto.randomUUID() }, req, now: new Date('2026-10-03T15:30:01Z') });
  assert.equal(separateDevice.attendance_id, attendanceId); assert.equal(separateDevice.unchanged, true);
  const [[openCount]] = await pool.query('SELECT COUNT(*) count FROM staff_attendance WHERE user_id=? AND clock_out IS NULL AND IFNULL(deleted,0)=0', [user.id]);
  assert.equal(openCount.count, 1, 'Distinct device request IDs cannot create concurrent open shifts.');
  await assert.rejects(() => actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: attendanceId, request_id: checkInId }, req, now: new Date('2026-10-03T16:00:00Z') }), { code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(() => actions.performAction({ user: other, input: { action: 'BREAK_START', attendance_id: attendanceId, request_id: crypto.randomUUID() }, req, now: new Date('2026-10-03T16:00:00Z') }), { code: 'ATTENDANCE_SESSION_NOT_FOUND' });
  const breakStartId = crypto.randomUUID();
  const breakStarts = await Promise.all([0, 1].map(() => actions.performAction({ user, input: { action: 'BREAK_START', attendance_id: attendanceId, request_id: breakStartId }, req, now: new Date('2026-10-03T16:00:00Z') })));
  assert.equal(breakStarts.filter(result => result.existing).length, 1);
  const [[breakCount]] = await pool.query('SELECT COUNT(*) count FROM attendance_break_intervals WHERE attendance_id=?', [attendanceId]); assert.equal(breakCount.count, 1);
  const onBreak = await daily.readToday({ user, now: new Date('2026-10-03T16:10:00Z') });
  assert.equal(onBreak.status, 'ON_BREAK'); assert.equal(onBreak.active_attendance.live_worked_minutes, 30); assert.equal(onBreak.active_attendance.live_break_minutes, 10);
  assert.equal(onBreak.break_policy.automatic_deduction, false);

  // Model a database commit whose reply is lost. SQL commits normally; only the
  // synthetic transport reply throws. Reconcile must recover its saved receipt.
  const endBreakId = crypto.randomUUID(), originalGetConnection = pool.getConnection;
  pool.getConnection = async function () {
    const connection = await originalGetConnection.call(pool), commit = connection.commit;
    connection.commit = async function () {
      connection.commit = commit; await commit.call(connection);
      throw Object.assign(new Error('Synthetic committed database reply lost'), { code: 'FIXTURE_COMMIT_REPLY_LOST' });
    };
    return connection;
  };
  try {
    await assert.rejects(() => actions.performAction({ user, input: { action: 'BREAK_END', attendance_id: attendanceId, request_id: endBreakId }, req, now: new Date('2026-10-03T16:15:00Z') }), { code: 'FIXTURE_COMMIT_REPLY_LOST' });
  } finally { pool.getConnection = originalGetConnection; }
  const reconciledBreak = await actions.reconcileAction({ user, requestId: endBreakId, now: new Date('2026-10-03T16:15:00Z') });
  assert.equal(reconciledBreak.found, true); assert.equal(reconciledBreak.receipt.action, 'BREAK_END'); assert.equal(reconciledBreak.receipt.attendance_id, attendanceId);
  const end = new Date('2026-10-03T17:30:00Z'), checkoutId = crypto.randomUUID();
  const invalidTaskRequest = crypto.randomUUID();
  await assert.rejects(() => actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: attendanceId, request_id: invalidTaskRequest, qr_proof: qr.createActionProof({ userId: user.id, action: 'CHECK_OUT', attendanceId, siteToken: qr.createSiteToken(end).token, now: end }).qr_proof, task_id: 999999 }, req, now: end }), { code: 'ATTENDANCE_TASK_UNAVAILABLE' });
  const [[afterFailedCheckout]] = await pool.query('SELECT clock_out,break_minutes FROM staff_attendance WHERE id=?', [attendanceId]);
  assert.equal(afterFailedCheckout.clock_out, null); assert.equal(afterFailedCheckout.break_minutes, 15);
  const [[invalidTaskReceipt]] = await pool.query('SELECT COUNT(*) count FROM attendance_action_receipts WHERE user_id=? AND request_id=?', [user.id, invalidTaskRequest]); assert.equal(invalidTaskReceipt.count, 0, 'A rejected checkout rolls back its receipt and leaves the exact session open.');
  const completed = await actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: attendanceId, request_id: checkoutId, qr_proof: await proof('CHECK_OUT', attendanceId, end) }, req, now: end });
  assert.equal(completed.attendance.total_minutes, 105, 'DST wall-clock jump does not add an hour; only the recorded 15-minute break is deducted.');
  assert.equal(completed.attendance.break_minutes, 15); assert.equal(completed.attendance.clock_out, '2026-10-03T17:30:00.000Z');
  await require('../services/checkoutSummaryService').saveCategory({user:{...mobileUsers.approver,permissions:['MANAGE_USERS']},input:{request_id:crypto.randomUUID(),name:'Synthetic verification',reason:'Configure an isolated test category'},req});
  const noteId = crypto.randomUUID(), note = { request_id: noteId, expected_revision: completed.attendance.revision, notes: 'Synthetic completed-shift note', category: 'Synthetic verification' };
  const notes = await actions.saveCheckoutNote({ user, attendanceId, input: note, req, now: new Date('2026-10-03T17:31:00Z') });
  assert.equal(notes.attendance.notes, note.notes); assert.equal(notes.attendance.checkout_category, note.category);
  assert.equal((await actions.saveCheckoutNote({ user, attendanceId, input: note, req, now: new Date('2026-10-03T17:32:00Z') })).existing, true);
  await assert.rejects(() => actions.saveCheckoutNote({ user, attendanceId, input: { ...note, request_id: crypto.randomUUID() }, req, now: new Date('2026-10-03T17:32:00Z') }), { code: 'ATTENDANCE_REVISION_CONFLICT' });
  await assert.rejects(() => actions.saveCheckoutNote({ user: other, attendanceId, input: { ...note, request_id: crypto.randomUUID() }, req, now: new Date('2026-10-03T17:32:00Z') }), { code: 'ATTENDANCE_SESSION_NOT_FOUND' });
  delete require.cache[require.resolve('../services/attendanceActionService')]; actions = require('../services/attendanceActionService');
  const restartedReceipt = await actions.reconcileAction({ user, requestId: checkoutId, now: new Date('2026-10-03T18:00:00Z') });
  assert.equal(restartedReceipt.found, true); assert.equal(restartedReceipt.receipt.attendance_id, attendanceId);
  assert.equal((await actions.reconcileAction({ user: other, requestId: checkoutId, now: new Date('2026-10-03T18:00:00Z') })).found, false);
  const secondStart = new Date('2026-10-03T18:00:00Z');
  const second = await actions.performAction({ user, input: { action: 'CHECK_IN', request_id: crypto.randomUUID(), qr_proof: await proof('CHECK_IN', null, secondStart) }, req, now: secondStart });
  assert.notEqual(second.attendance_id, attendanceId);
  const oldReplay = await actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: attendanceId, request_id: checkoutId, qr_proof: 'expired-proof-must-not-replace-committed-receipt' }, req, now: secondStart });
  assert.equal(oldReplay.existing, true); assert.equal(oldReplay.attendance_id, attendanceId);
  assert.equal(oldReplay.state.active_attendance.id, second.attendance_id, 'A completed old checkout retry never closes a newer shift.');
  const secondEnd = new Date('2026-10-03T18:30:00Z');
  await actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: second.attendance_id, request_id: crypto.randomUUID(), qr_proof: await proof('CHECK_OUT', second.attendance_id, secondEnd) }, req, now: secondEnd });
  const day = await daily.readToday({ user, now: secondEnd });
  assert.equal(day.summary.worked_minutes, 135); assert.equal(day.summary.session_count, 2);
  assert.equal(day.summary.recorded_break_minutes, 15); assert.equal(day.summary.review_required, false);
  assert.deepEqual(day.timeline.map(event => event.type), ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT', 'CHECK_IN', 'CHECK_OUT']);
  assert.deepEqual((await daily.readToday({ user: other, now: secondEnd })).sessions, [], 'Daily timelines are scoped to the authenticated account.');
  const overnightStart = new Date('2026-10-04T12:30:00Z');
  const overnight = await actions.performAction({ user, input: { action: 'CHECK_IN', request_id: crypto.randomUUID(), qr_proof: await proof('CHECK_IN', null, overnightStart) }, req, now: overnightStart });
  const tomorrow = await daily.readToday({ user, now: new Date('2026-10-04T13:30:00Z') });
  assert.equal(tomorrow.work_date, '2026-10-05'); assert.equal(tomorrow.active_attendance.overnight, true);
  assert.equal(tomorrow.active_attendance.allocated_work_date, '2026-10-04'); assert.equal(tomorrow.active_attendance.live_worked_minutes, 60);
  assert.equal(tomorrow.summary.live_worked_minutes, 0, 'An overnight shift remains allocated to its start date rather than entering tomorrow twice.');
  const overnightEnd = new Date('2026-10-04T14:00:00Z');
  const overnightComplete = await actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: overnight.attendance_id, request_id: crypto.randomUUID(), qr_proof: await proof('CHECK_OUT', overnight.attendance_id, overnightEnd) }, req, now: overnightEnd });
  assert.equal(overnightComplete.attendance.total_minutes, 90); assert.equal(overnightComplete.attendance.work_date, '2026-10-04');
  const [legacy] = await pool.query("INSERT INTO staff_attendance(user_id,clock_in,work_date,total_minutes,total_hours,notes) VALUES(?,'2026-10-10 09:00:00','2026-10-10',120,2,'Synthetic unverified legacy session')", [other.id]);
  const legacyEnd = new Date('2026-10-10T01:30:00Z');
  assert.deepEqual((await daily.readToday({ user: other, now: legacyEnd })).allowed_actions, ['CHECK_OUT'], 'An unverified active legacy session permits controlled checkout without advertising an unsupported new break.');
  const legacyProof = await actions.resolveQr({ user: other, input: { action: 'CHECK_OUT', attendance_id: legacy.insertId, token: qr.createSiteToken(legacyEnd).token }, now: legacyEnd });
  const legacyClosed = await actions.performAction({ user: other, input: { action: 'CHECK_OUT', attendance_id: legacy.insertId, request_id: crypto.randomUUID(), qr_proof: legacyProof.qr_proof }, req, now: legacyEnd });
  assert.equal(legacyClosed.attendance.review_required, true); assert.equal(legacyClosed.attendance.review_reason, 'ATTENDANCE_TIMEZONE_UNVERIFIED');
  assert.equal(legacyClosed.attendance.total_minutes, 120, 'Closing an unverified legacy session does not invent UTC worked time.');
  const [[legacyStored]] = await pool.query("SELECT DATE_FORMAT(clock_in,'%Y-%m-%d %H:%i:%s') clock_in,timestamp_basis,clock_out_timestamp_basis FROM staff_attendance WHERE id=?", [legacy.insertId]);
  assert.deepEqual(legacyStored, { clock_in: '2026-10-10 09:00:00', timestamp_basis: null, clock_out_timestamp_basis: 'UTC' });
  const legacyDaily = await daily.readToday({ user: other, now: legacyEnd });
  assert.equal(legacyDaily.summary.worked_minutes, 0); assert.equal(legacyDaily.summary.review_required, true, 'Unverified legacy time stays excluded from authoritative daily work totals.');
  assert.deepEqual(await historicalState(), historicalRows, 'Attendance actions and new metadata preserve historical unverified clock values.');
  facts.push('real durable attendance receipts, concurrent devices/single session, lost-commit reconciliation, actual breaks, UTC/DST/overnight allocation, exact-session notes, scoped timelines and old checkout replay safety');
}

async function testCheckoutSummaryOptions() {
  const summary=require('../services/checkoutSummaryService'),actions=require('../services/attendanceActionService');
  const user=mobileUsers.other,admin={...mobileUsers.approver,permissions:['MANAGE_USERS']},req={ip:'127.0.0.1',requestId:'synthetic-summary-sql',get:()=> 'Synthetic isolated summary test'};
  const input={request_id:crypto.randomUUID(),name:'Synthetic configured work',reason:'Configure a first-use category fixture',site_id:require('../services/attendanceQrService').siteId(),role_scope:'staff'};
  const configured=await summary.saveCategory({user:admin,input,req});
  assert.equal((await summary.saveCategory({user:admin,input,req})).existing,true);
  await assert.rejects(()=>summary.saveCategory({user,input,req}),{code:'WORK_CATEGORY_ACCESS_DENIED'});
  await pool.query(`CREATE TABLE IF NOT EXISTS tasks(id INT AUTO_INCREMENT PRIMARY KEY,title VARCHAR(180),assigned_to INT,status VARCHAR(40),due_date DATE NULL,deleted TINYINT DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const [[clock]]=await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') at,DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 HOUR),'%Y-%m-%d %H:%i:%s') started");
  const tasks=[];
  for(const [title,owner,status]of [['Synthetic open task',user.id,'pending'],['Synthetic completed task',user.id,'done'],['Synthetic unrelated task',mobileUsers.staff.id,'done'],['Synthetic cancelled task',user.id,'cancelled'],['Synthetic formerly assigned task',mobileUsers.staff.id,'done']]){
    const [insert]=await pool.query('INSERT INTO tasks(title,assigned_to,status,created_at) VALUES(?,?,?,?)',[title,owner,status,clock.started]);tasks.push(insert.insertId);
  }
  await require('../services/auditService').logAudit(pool,{actorId:user.id,module:'Tasks',recordType:'task',recordId:tasks[4],action:'TASK_STATUS_CHANGED',newValue:{status:'done',assigned_to:user.id}});
  const [[end]]=await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%d %H:%i:%s') at");
  const [insert]=await pool.query("INSERT INTO staff_attendance(user_id,clock_in,clock_out,work_date,total_minutes,total_hours,timestamp_basis,clock_out_timestamp_basis,revision) VALUES(?,?,?,DATE(?),120,2,'UTC','UTC',1)",[user.id,clock.started,end.at,clock.started]);
  const id=insert.insertId,options=await summary.options({user,attendanceId:id});
  assert(options.categories.items.some(c=>c.id===configured.item.id),'Employee with no category history sees active company configuration.');
  for(const n of [0,1,4])assert(options.tasks.items.some(t=>t.id===tasks[n]),'Current and evidenced shift assignments include completed tasks.');
  for(const n of [2,3])assert(!options.tasks.items.some(t=>t.id===tasks[n]));
  const note={request_id:crypto.randomUUID(),expected_revision:1,task_id:tasks[1],category_id:configured.item.id,notes:'Synthetic saved shift summary'};
  const writes=await Promise.all([0,1].map(()=>actions.saveCheckoutNote({user,attendanceId:id,input:note,req})));
  assert.equal(writes.filter(r=>r.existing).length,1);assert.equal(writes[0].attendance.checkout_category_id,configured.item.id);
  const rename={...input,request_id:crypto.randomUUID(),expected_revision:configured.item.revision,name:'Synthetic renamed work',reason:'Rename a test category'};
  const renamed=await summary.saveCategory({user:admin,id:configured.item.id,input:rename,req});
  const inactive=await summary.saveCategory({user:admin,id:configured.item.id,input:{...rename,request_id:crypto.randomUUID(),expected_revision:renamed.item.revision,active:false,reason:'Deactivate a test category'},req});
  await assert.rejects(()=>summary.saveCategory({user:admin,id:configured.item.id,input:{...rename,request_id:crypto.randomUUID()},req}),{code:'ATTENDANCE_REVISION_CONFLICT'});
  const current=await summary.options({user,attendanceId:id});
  assert(!current.categories.items.some(c=>c.id===configured.item.id));assert.equal(current.attendance.checkout_category,'Synthetic configured work');assert.equal(current.attendance.checkout_task_title,'Synthetic completed task');
  const edited=await actions.saveCheckoutNote({user,attendanceId:id,input:{...note,request_id:crypto.randomUUID(),expected_revision:writes[0].attendance.revision,notes:'Synthetic historical summary correction'},req});
  assert.equal(edited.attendance.checkout_category,'Synthetic configured work','Inactive renamed category preserves the recorded snapshot.');
  await assert.rejects(()=>summary.validateReferences(pool,user,{...current.attendance,checkout_category_id:null,checkout_category:null},{category_id:inactive.item.id,task_id:null}),{code:'ATTENDANCE_CATEGORY_UNAVAILABLE'});
  await assert.rejects(()=>actions.saveCheckoutNote({user,attendanceId:id,input:{...note,request_id:crypto.randomUUID(),expected_revision:edited.attendance.revision,task_id:tasks[2]},req}),{code:'ATTENDANCE_TASK_UNAVAILABLE'});
  await assert.rejects(()=>summary.options({user:mobileUsers.staff,attendanceId:id}),{code:'ATTENDANCE_SESSION_NOT_FOUND'});
  delete require.cache[require.resolve('../services/checkoutSummaryService')];
  assert.equal((await require('../services/checkoutSummaryService').options({user,attendanceId:id})).attendance.notes,'Synthetic historical summary correction');
  const [[counts]]=await pool.query("SELECT COUNT(*) total FROM audit_logs WHERE record_type='staff_attendance' AND record_id=? AND action='CHECKOUT_NOTE'",[String(id)]);
  assert.equal(counts.total,2,'Repeated transport requests write exactly one summary and audit per revision.');
  const [[persisted]]=await pool.query("SELECT DATE_FORMAT(clock_out,'%Y-%m-%d %H:%i:%s') clock_out,revision FROM staff_attendance WHERE id=?",[id]);assert.equal(persisted.clock_out,end.at);assert.equal(persisted.revision,3);
  const [[task]]=await pool.query('SELECT status FROM tasks WHERE id=?',[tasks[0]]);assert.equal(task.status,'pending','Summary changes never complete a task or job.');
  assert.deepEqual(await historicalState(),historicalRows);
  facts.push('real InnoDB first-use company categories, completed/current/evidenced task assignments, scoped rejection, audited category rename/deactivate and historical snapshot preservation, exact-session revisions, concurrent summary idempotency and service-restart persistence');
}

async function testAttendanceCorrections() {
  const corrections = require('../services/attendanceCorrectionService'), user = mobileUsers.staff;
  const req = { user, ip: '127.0.0.1', id: 'synthetic-correction-sql', get: () => 'Synthetic correction SQL fixture' };
  const now = new Date('2026-10-13T00:00:00Z');
  const [[first]] = await pool.query('SELECT * FROM staff_attendance WHERE user_id=? ORDER BY id LIMIT 1', [user.id]);
  const [originalBreaks] = await pool.query('SELECT id,started_at,ended_at,start_request_id,end_request_id FROM attendance_break_intervals WHERE attendance_id=? ORDER BY id', [first.id]);
  const input = { request_id: crypto.randomUUID(), attendance_id: first.id, expected_revision: first.revision, clock_in: '2026-10-04T01:40:00+10:00', clock_out: '2026-10-04T04:30:00+11:00', break_minutes: 10, notes: 'Synthetic reviewed correction', reason: 'Synthetic actual start and break correction' };
  const requested = await corrections.requestCorrection({ user, input, req, now });
  assert.equal(requested.correction.status, 'PENDING');
  assert.equal(requested.correction.proposed.clock_in, '2026-10-03T15:40:00Z');
  assert.equal(requested.correction.proposed.clock_out, '2026-10-03T17:30:00Z');
  const [[unchanged]] = await pool.query('SELECT * FROM staff_attendance WHERE id=?', [first.id]);
  assert.deepEqual(unchanged, first, 'A correction request preserves original attendance until authorised approval.');
  assert.equal((await corrections.requestCorrection({ user, input, req, now })).correction.id, requested.correction.id);
  await assert.rejects(() => corrections.requestCorrection({ user, input: { ...input, reason: 'Conflicting reuse of correction UUID' }, req, now }), { code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(() => corrections.decideCorrection({ user: { ...user, permissions: [...user.permissions, 'EDIT_ATTENDANCE'] }, id: requested.correction.id, input: { expected_revision: 1, reason: 'Synthetic self-approval attempt' }, decision: 'APPROVED', req, now }), { code: 'ATTENDANCE_CORRECTION_ACCESS_DENIED' });
  assert.equal((await corrections.listCorrections({ user, query: { scope: 'own' } })).total, 1);
  const team = await corrections.listCorrections({ user: mobileUsers.manager, query: { scope: 'team' } });
  assert.equal(team.total, 1); assert.equal(team.corrections[0].can_review, true);
  assert.equal((await corrections.listCorrections({ user: mobileUsers.outsideManager, query: { scope: 'team' } })).total, 0);
  await assert.rejects(() => corrections.getCorrection({ user: mobileUsers.outsideManager, id: requested.correction.id }), { code: 'ATTENDANCE_CORRECTION_NOT_FOUND' });
  await assert.rejects(() => corrections.listCorrections({ user, query: { scope: 'all' } }), { code: 'ATTENDANCE_CORRECTION_ACCESS_DENIED' });
  // An already-retained pending proposal serialized exact whole seconds as
  // .000Z. Review must recover it without a broad migration or rewriting its
  // original proposal bytes; genuine fractional instants remain rejected.
  const [[pendingSource]] = await pool.query('SELECT proposed_json FROM attendance_correction_requests WHERE id=?', [requested.correction.id]);
  const legacyProposal = JSON.parse(pendingSource.proposed_json);
  legacyProposal.clock_in = legacyProposal.clock_in.replace(/Z$/, '.000Z');
  legacyProposal.clock_out = legacyProposal.clock_out.replace(/Z$/, '.000Z');
  const legacyProposalBytes = JSON.stringify(legacyProposal);
  await pool.query('UPDATE attendance_correction_requests SET proposed_json=? WHERE id=?', [legacyProposalBytes, requested.correction.id]);
  await assert.rejects(() => corrections.requestCorrection({ user, input: { ...input, request_id: crypto.randomUUID(), clock_in: '2026-10-03T15:40:00.001Z' }, req, now }), { code: 'ATTENDANCE_TIME_INVALID' });
  const decision = { expected_revision: requested.correction.revision, reason: 'Synthetic supervisor verified actual times' };
  const approved = await Promise.all([0, 1].map(() => corrections.decideCorrection({ user: mobileUsers.manager, id: requested.correction.id, input: decision, decision: 'APPROVED', req, now })));
  assert.equal(approved.filter(result => result.existing).length, 1);
  assert.equal(approved[0].attendance.total_minutes, 100);
  assert.equal(approved[0].attendance.entry_source, 'MANUAL'); assert.equal(approved[0].attendance.manual_authorised_by, mobileUsers.manager.id);
  assert.equal(approved[0].attendance.timestamp_basis, 'UTC'); assert.equal(approved[0].attendance.recorded_timezone, 'Australia/Sydney');
  const [[retainedProposal]] = await pool.query('SELECT proposed_json FROM attendance_correction_requests WHERE id=?', [requested.correction.id]);
  assert.equal(retainedProposal.proposed_json, legacyProposalBytes, 'Approval leaves retained .000Z proposal bytes intact while establishing the exact worked seconds.');
  const [preservedBreaks] = await pool.query('SELECT id,started_at,ended_at,start_request_id,end_request_id FROM attendance_break_intervals WHERE attendance_id=? ORDER BY id', [first.id]);
  assert.deepEqual(preservedBreaks, originalBreaks, 'Approved corrections supersede break evidence without rewriting its original timestamps or request IDs.');
  const [[effectiveBreaks]] = await pool.query('SELECT COUNT(*) count FROM attendance_break_intervals WHERE attendance_id=? AND superseded_at IS NULL', [first.id]);
  assert.equal(effectiveBreaks.count, 0);
  const [[superseded]] = await pool.query('SELECT superseded_by,superseded_by_correction_id FROM attendance_break_intervals WHERE attendance_id=?', [first.id]);
  assert.equal(superseded.superseded_by, mobileUsers.manager.id); assert.equal(superseded.superseded_by_correction_id, requested.correction.id);

  const lockedInput = { ...input, request_id: crypto.randomUUID(), expected_revision: approved[0].attendance.revision, clock_in: '2026-10-04T01:45:00+10:00', reason: 'Synthetic correction awaiting period amendment' };
  const lockedRequest = await corrections.requestCorrection({ user, input: lockedInput, req, now });
  const [period] = await pool.query("INSERT INTO weekly_timesheets(user_id,week_start,week_end,status) VALUES(?,'2026-09-28','2026-10-04','APPROVED')", [user.id]);
  const lockedDecision = { user: mobileUsers.manager, id: lockedRequest.correction.id, input: { expected_revision: 1, reason: 'Synthetic locked-period review' }, decision: 'APPROVED', req, now };
  await assert.rejects(() => corrections.decideCorrection(lockedDecision), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  await pool.query("UPDATE weekly_timesheets SET status='DRAFT' WHERE id=?", [period.insertId]);
  await pool.query("INSERT INTO payroll_ready(timesheet_id,user_id,period_start,period_end,status,locked_at) VALUES(?,?,'2026-09-28','2026-10-04','LOCKED',NOW())", [period.insertId, user.id]);
  await assert.rejects(() => corrections.decideCorrection({ ...lockedDecision, user: mobileUsers.approver }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  const [[stillApproved]] = await pool.query('SELECT revision,total_minutes FROM staff_attendance WHERE id=?', [first.id]);
  assert.equal(stillApproved.revision, approved[0].attendance.revision); assert.equal(stillApproved.total_minutes, 100);
  await pool.query('UPDATE users SET manager_id=? WHERE id=?', [mobileUsers.outsideManager.id, user.id]);
  try { await assert.rejects(() => corrections.decideCorrection(lockedDecision), { code: 'ATTENDANCE_CORRECTION_ACCESS_DENIED' }); }
  finally { await pool.query('UPDATE users SET manager_id=? WHERE id=?', [mobileUsers.manager.id, user.id]); }

  const missing = { request_id: crypto.randomUUID(), correction_type: 'MISSING_SESSION', clock_in: '2026-10-06T09:00:00+11:00', clock_out: '2026-10-06T10:30:00+11:00', break_minutes: 15, notes: 'Synthetic missing-session request', reason: 'Synthetic missed start/end request' };
  const [[beforeMissing]] = await pool.query('SELECT COUNT(*) count FROM staff_attendance WHERE user_id=?', [user.id]);
  const missingRequest = await corrections.requestCorrection({ user, input: missing, req, now });
  assert.equal(missingRequest.correction.status, 'PENDING'); assert.equal(missingRequest.correction.attendance_id, null);
  const [[afterPendingMissing]] = await pool.query('SELECT COUNT(*) count FROM staff_attendance WHERE user_id=?', [user.id]);
  assert.equal(afterPendingMissing.count, beforeMissing.count, 'Pending missing-session requests never add claimed worked time.');
  assert.equal((await corrections.requestCorrection({ user, input: missing, req, now })).correction.id, missingRequest.correction.id);
  await assert.rejects(() => corrections.requestCorrection({ user, input: { ...missing, clock_out: '2026-10-06T11:00:00+11:00' }, req, now }), { code: 'ATTENDANCE_IDEMPOTENCY_CONFLICT' });
  const missingApproved = await corrections.decideCorrection({ user: mobileUsers.manager, id: missingRequest.correction.id, input: { expected_revision: 1, reason: 'Synthetic supervisor approved evidence' }, decision: 'APPROVED', req, now });
  assert.ok(missingApproved.attendance.id); assert.equal(missingApproved.attendance.entry_source, 'MANUAL');
  assert.equal(missingApproved.attendance.total_minutes, 75); assert.equal(missingApproved.attendance.work_date, '2026-10-06');
  assert.equal(missingApproved.attendance.manual_authorised_by, mobileUsers.manager.id);
  const missingReplay = await corrections.decideCorrection({ user: mobileUsers.manager, id: missingRequest.correction.id, input: { expected_revision: 1, reason: 'Synthetic supervisor approved evidence' }, decision: 'APPROVED', req, now });
  assert.equal(missingReplay.existing, true); assert.equal(missingReplay.attendance.id, missingApproved.attendance.id);
  const [[afterMissingApproval]] = await pool.query('SELECT COUNT(*) count FROM staff_attendance WHERE user_id=?', [user.id]); assert.equal(afterMissingApproval.count, beforeMissing.count + 1);
  const overlapInput = { ...missing, request_id: crypto.randomUUID(), clock_in: '2026-10-06T09:15:00+11:00', clock_out: '2026-10-06T10:00:00+11:00', break_minutes: 0, reason: 'Synthetic overlap must be rejected' };
  let overlapRequest;
  try { overlapRequest = await corrections.requestCorrection({ user, input: overlapInput, req, now }); }
  catch (error) { assert.equal(error.code, 'ATTENDANCE_CORRECTION_OVERLAP'); }
  if (overlapRequest) await assert.rejects(() => corrections.decideCorrection({ user: mobileUsers.manager, id: overlapRequest.correction.id, input: { expected_revision: 1, reason: 'Synthetic overlapping review' }, decision: 'APPROVED', req, now }), { code: 'ATTENDANCE_CORRECTION_OVERLAP' });
  for (const invalidStart of ['2026-10-04T02:30:00', '2026-04-05T02:30:00']) await assert.rejects(() => corrections.requestCorrection({ user, input: { ...missing, request_id: crypto.randomUUID(), clock_in: invalidStart, clock_out: null }, req, now }), { code: 'ATTENDANCE_TIME_INVALID' });
  const [[afterRejectedOverlap]] = await pool.query('SELECT COUNT(*) count FROM staff_attendance WHERE user_id=?', [user.id]); assert.equal(afterRejectedOverlap.count, beforeMissing.count + 1);
  const daily = require('../services/attendanceDailyService');
  const [attendanceBeforeRead] = await pool.query('SELECT * FROM staff_attendance WHERE user_id IN (?,?) ORDER BY id', [user.id, mobileUsers.other.id]);
  const teamSessions = await daily.listSessions({ user: mobileUsers.manager, query: { scope: 'team', page_size: 1, status: 'ALL', from: '2026-10-04', to: '2026-10-10' } });
  assert.equal(teamSessions.sessions.length, 1); assert.equal(teamSessions.total, 4); assert.equal(teamSessions.pages, 4);
  assert.equal(teamSessions.summary.session_count, 4, 'Team summary counts cover all filtered sessions independently of the page.');
  assert.equal(teamSessions.sessions[0].user_id, user.id); assert.equal(teamSessions.sessions[0].staff_name, 'Synthetic staff SQL fixture');
  assert.equal(teamSessions.sessions[0].staff_department, 'Synthetic verification team');
  const outsideSessions = await daily.listSessions({ user: mobileUsers.outsideManager, query: { scope: 'team', page_size: 100 } });
  assert.equal(outsideSessions.total, 1); assert.ok(outsideSessions.sessions.every(session => session.user_id === mobileUsers.other.id));
  await assert.rejects(() => daily.listSessions({ user, query: { scope: 'team' } }), { code: 'ATTENDANCE_TEAM_ACCESS_DENIED' });
  await assert.rejects(() => daily.listSessions({ user: mobileUsers.manager, query: { scope: 'all' } }), { code: 'ATTENDANCE_TEAM_ACCESS_DENIED' });
  const ownSessions = await daily.listMySessions({ user, query: { page: 1, page_size: 1, from: '2026-10-04', to: '2026-10-10' } });
  assert.equal(ownSessions.total, 4); assert.equal(ownSessions.pages, 4); assert.equal(ownSessions.attendance.length, 1);
  const [attendanceAfterRead] = await pool.query('SELECT * FROM staff_attendance WHERE user_id IN (?,?) ORDER BY id', [user.id, mobileUsers.other.id]);
  assert.deepEqual(attendanceAfterRead, attendanceBeforeRead, 'Team/own overview reads cannot mutate attendance records.');
  await pool.query('UPDATE users SET active=0 WHERE id=?', [user.id]);
  try {
    assert.equal((await corrections.listCorrections({ user: mobileUsers.manager, query: { scope: 'team' } })).total, 0, 'Inactive team accounts do not appear in correction scope.');
    assert.equal((await daily.listSessions({ user: mobileUsers.manager, query: { scope: 'team' } })).total, 0);
    await assert.rejects(() => corrections.getCorrection({ user: mobileUsers.manager, id: requested.correction.id }), { code: 'ATTENDANCE_CORRECTION_NOT_FOUND' });
    await assert.rejects(() => corrections.decideCorrection({ ...lockedDecision }), { code: 'ATTENDANCE_CORRECTION_ACCESS_DENIED' });
  } finally { await pool.query('UPDATE users SET active=1 WHERE id=?', [user.id]); }
  assert.deepEqual(await historicalState(), historicalRows, 'Corrections preserve pre-existing unverified historical attendance and all original stored records.');
  facts.push('real correction request/decision idempotency, pending preservation, team/private review authority, effective break supersession, approved/payroll locks, missing-session approval and overlap/DST guards');
}

async function testAttendancePeriodActionGuards() {
  const actions = require('../services/attendanceActionService'), qr = require('../services/attendanceQrService'), user = mobileUsers.staff;
  const req = { user, ip: '127.0.0.1', id: 'synthetic-locked-action-sql', get: () => 'Synthetic locked attendance SQL fixture' };
  const [[completed]] = await pool.query('SELECT * FROM staff_attendance WHERE user_id=? ORDER BY id LIMIT 1', [user.id]);
  const now = new Date('2026-10-04T00:00:00Z');
  const blockedNoteId = crypto.randomUUID();
  await assert.rejects(() => actions.saveCheckoutNote({ user, attendanceId: completed.id, input: { request_id: blockedNoteId, expected_revision: completed.revision, notes: 'Synthetic locked note attempt' }, req, now }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  const [[savedNote]] = await pool.query("SELECT request_id,response_json FROM attendance_action_receipts WHERE user_id=? AND attendance_id=? AND action='CHECKOUT_NOTE' ORDER BY id LIMIT 1", [user.id, completed.id]);
  const noteReceipt = JSON.parse(savedNote.response_json);
  const replayedNote = await actions.saveCheckoutNote({ user, attendanceId: completed.id, input: { request_id: savedNote.request_id, expected_revision: noteReceipt.attendance.revision - 1, notes: noteReceipt.attendance.notes, category: noteReceipt.attendance.checkout_category }, req, now });
  assert.equal(replayedNote.existing, true, 'A previously committed receipt remains reconcilable after period locking.');
  const [[afterBlockedNote]] = await pool.query('SELECT * FROM staff_attendance WHERE id=?', [completed.id]); assert.deepEqual(afterBlockedNote, completed);
  const newShiftId = crypto.randomUUID();
  const newShiftProof = await actions.resolveQr({ user, input: { action: 'CHECK_IN', token: qr.createSiteToken(now).token }, now });
  await assert.rejects(() => actions.performAction({ user, input: { action: 'CHECK_IN', request_id: newShiftId, qr_proof: newShiftProof.qr_proof }, req, now }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  // An approved/locked week can contain a zero-hour unfinished legacy row.
  // Every new mutation must respect that period, including break and checkout.
  const [open] = await pool.query(`INSERT INTO staff_attendance(user_id,clock_in,work_date,total_minutes,total_hours,entry_source,timestamp_basis,recorded_timezone,attendance_status,revision)
    VALUES(?,'2026-10-03 20:00:00','2026-10-04',0,0,'CLOCK','UTC','Australia/Sydney','INCOMPLETE',1)`, [user.id]);
  const [[beforeOpen]] = await pool.query('SELECT * FROM staff_attendance WHERE id=?', [open.insertId]);
  const startBreakId = crypto.randomUUID();
  await assert.rejects(() => actions.performAction({ user, input: { action: 'BREAK_START', attendance_id: open.insertId, request_id: startBreakId }, req, now }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  const [[noBreak]] = await pool.query('SELECT COUNT(*) count FROM attendance_break_intervals WHERE attendance_id=?', [open.insertId]); assert.equal(noBreak.count, 0);
  const [interval] = await pool.query("INSERT INTO attendance_break_intervals(attendance_id,user_id,started_at,start_request_id) VALUES(?,?,'2026-10-03 21:00:00',?)", [open.insertId, user.id, crypto.randomUUID()]);
  const endBreakId = crypto.randomUUID(), checkoutId = crypto.randomUUID();
  await assert.rejects(() => actions.performAction({ user, input: { action: 'BREAK_END', attendance_id: open.insertId, request_id: endBreakId }, req, now }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  const checkoutProof = await actions.resolveQr({ user, input: { action: 'CHECK_OUT', attendance_id: open.insertId, token: qr.createSiteToken(now).token }, now });
  await assert.rejects(() => actions.performAction({ user, input: { action: 'CHECK_OUT', attendance_id: open.insertId, request_id: checkoutId, qr_proof: checkoutProof.qr_proof }, req, now }), { code: 'ATTENDANCE_PERIOD_LOCKED' });
  const [[afterOpen]] = await pool.query('SELECT * FROM staff_attendance WHERE id=?', [open.insertId]); assert.deepEqual(afterOpen, beforeOpen);
  const [[preservedInterval]] = await pool.query('SELECT ended_at,end_request_id FROM attendance_break_intervals WHERE id=?', [interval.insertId]);
  assert.deepEqual(preservedInterval, { ended_at: null, end_request_id: null });
  const [[failedReceipts]] = await pool.query('SELECT COUNT(*) count FROM attendance_action_receipts WHERE user_id=? AND request_id IN (?,?,?,?,?)', [user.id, blockedNoteId, newShiftId, startBreakId, endBreakId, checkoutId]);
  assert.equal(failedReceipts.count, 0, 'Rejected locked-period actions do not leave success receipts.');
  assert.deepEqual(await historicalState(), historicalRows);
  facts.push('actual locked-period check-in/checkout/break/note rollback, zero-hour open-session protection, immutable break intervals and durable prior receipt replay');
}

async function testVerifiedAttendanceTotals() {
  const { Settings } = require('luxon'), originalNow = Settings.now;
  const user = { id: 171, role: 'staff', permissions: ['VIEW_ATTENDANCE', 'VIEW_OWN_TIMESHEET'] };
  const controller = require('../controllers/attendanceController'), workflow = require('../services/timesheetWorkflowService');
  const verified = require('../services/attendanceVerifiedSummaryService');
  await pool.query(`INSERT INTO users(id,name,username,email,password,role,permissions,active,manager_id)
    VALUES(?,'Synthetic verified totals SQL fixture','synthetic-verified-totals','verified-totals@example.invalid','not-a-login-hash',?,?,1,?)`, [user.id, user.role, JSON.stringify(user.permissions), mobileUsers.manager.id]);
  const insert = async ({ start, end, minutes, status = 'COMPLETED', basis = 'UTC', notes = 'Synthetic verified hour' }) => {
    const [result] = await pool.query(`INSERT INTO staff_attendance(user_id,clock_in,clock_out,work_date,total_minutes,total_hours,break_minutes,entry_source,timestamp_basis,clock_out_timestamp_basis,recorded_timezone,attendance_status,notes)
      VALUES(?,?,?,'2026-10-12',?,?,0,'CLOCK',?,?,?, ?,?)`, [user.id, start, end, minutes, Math.round(minutes / 60 * 100) / 100, basis, basis, basis ? 'Australia/Sydney' : null, status, notes]);
    return result.insertId;
  };
  const valid = { start: '2026-10-11 22:00:00', end: '2026-10-11 23:00:00', minutes: 60 };
  const ids = [await insert(valid), await insert(valid),
    await insert({ start: '2026-10-12 00:00:00', end: '2026-10-12 02:00:00', minutes: 120, status: 'REJECTED' }),
    await insert({ start: '2026-10-12 02:00:00', end: '2026-10-12 05:00:00', minutes: 180, status: 'CANCELLED' }),
    await insert({ start: '2026-10-12 09:00:00', end: '2026-10-12 13:00:00', minutes: 240, basis: null, notes: 'Synthetic unzoned claimed time' })];
  const raw = async () => (await pool.query('SELECT * FROM staff_attendance WHERE user_id=? ORDER BY id', [user.id]))[0];
  const preservedRaw = await raw();
  const assessment = await verified.loadVerifiedSummary({ db: pool, userId: user.id, fromDate: '2026-10-12', toDate: '2026-10-18', now: new Date('2026-10-13T00:00:00Z') });
  assert.equal(assessment.totalMinutes, 60); assert.equal(assessment.actualHours, 1);
  assert.equal(assessment.historicalSavedHours, 11); assert.equal(assessment.duplicates, 1);
  assert.deepEqual(assessment.eligibleRecords.map(row => row.id), [ids[0]]);
  assert.equal(assessment.reviewRequired, true);
  assert.deepEqual(assessment.reviewIssues, [{ code: 'ATTENDANCE_TIMEZONE_UNVERIFIED', attendance_id: ids[4] }]);
  const [sheet] = await pool.query(`INSERT INTO weekly_timesheets(user_id,week_start,week_end,total_hours,status)
    VALUES(?,'2026-10-12','2026-10-18',77,'DRAFT')`, [user.id]);
  const req = { user, ip: '127.0.0.1', get: () => 'Synthetic verified totals SQL fixture' };
  const snapshot = async () => ({
    sheet: (await pool.query('SELECT * FROM weekly_timesheets WHERE id=?', [sheet.insertId]))[0],
    versions: (await pool.query('SELECT * FROM timesheet_versions WHERE timesheet_id=? ORDER BY id', [sheet.insertId]))[0],
    approvals: (await pool.query('SELECT * FROM timesheet_approvals WHERE timesheet_id=? ORDER BY id', [sheet.insertId]))[0],
    payroll: (await pool.query('SELECT * FROM payroll_ready WHERE timesheet_id=?', [sheet.insertId]))[0],
    queue: (await pool.query('SELECT COUNT(*) count FROM email_queue'))[0]
  });
  try {
    // Freeze only the local fixture's calendar to exercise the real current-week
    // route; database UTC and all preserved source timestamps remain unchanged.
    Settings.now = () => new Date('2026-10-13T00:00:00Z').getTime();
    const week = response(); await controller.weekAttendance(req, week);
    assert.equal(week.statusCode, 200); assert.equal(week.body.total_hours, 1);
    assert.equal(week.body.verified_total_minutes, 60); assert.equal(week.body.historical_saved_hours, 11);
    assert.equal(week.body.duplicate_records, 1); assert.equal(week.body.review_required, true);
    assert.equal(Number(week.body.timesheet.total_hours), 1);
    const detail = await workflow.getTimesheetDetail(sheet.insertId, user);
    assert.equal(detail.summary.actualHours, 1); assert.equal(detail.summary.historical_saved_hours, 11);
    assert.equal(detail.summary.reviewRequired, true); assert.equal(detail.summary.duplicate_records, 1);
    const beforeSubmit = await snapshot();
    await assert.rejects(() => workflow.submitTimesheet(sheet.insertId, user, req), { code: 'TIMESHEET_ATTENDANCE_REVIEW_REQUIRED', statusCode: 409 });
    assert.deepEqual(await snapshot(), beforeSubmit, 'Unverified source time cannot create submitted versions, approvals, payroll or mail.');
    await pool.query("UPDATE weekly_timesheets SET status='PENDING_APPROVAL' WHERE id=?", [sheet.insertId]);
    const beforeApprove = await snapshot();
    await assert.rejects(() => workflow.approveTimesheet(sheet.insertId, mobileUsers.approver, { approvedHours: 99 }, req), { code: 'TIMESHEET_ATTENDANCE_REVIEW_REQUIRED', statusCode: 409 });
    assert.deepEqual(await snapshot(), beforeApprove, 'An explicit approved-hours override cannot bypass source review.');
    const originalSnapshot = '{"fixture":"synthetic approved history","hours":77,"preserve":true}';
    await pool.query("UPDATE weekly_timesheets SET status='APPROVED',total_hours=77,approved_hours=77,ordinary_hours=38,overtime_hours=39,version_no=1 WHERE id=?", [sheet.insertId]);
    await pool.query("INSERT INTO timesheet_versions(timesheet_id,version_no,status,snapshot_json,created_by) VALUES(?,1,'APPROVED',?,?)", [sheet.insertId, originalSnapshot, mobileUsers.approver.id]);
    const beforeApprovedRead = await snapshot();
    const approvedWeek = response(); await controller.weekAttendance(req, approvedWeek);
    assert.equal(approvedWeek.statusCode, 200); assert.equal(approvedWeek.body.total_hours, 1);
    assert.equal(Number(approvedWeek.body.timesheet.total_hours), 77, 'Verified current diagnostics coexist with unchanged historical approved totals.');
    const approvedDetail = await workflow.getTimesheetDetail(sheet.insertId, user);
    assert.equal(approvedDetail.summary.actualHours, 1); assert.equal(Number(approvedDetail.timesheet.approved_hours), 77);
    assert.deepEqual(await snapshot(), beforeApprovedRead, 'Reading verified totals does not rewrite approved rows or their original version bytes.');
    assert.deepEqual(await raw(), preservedRaw, 'Duplicate, rejected, cancelled and unzoned records remain intact.');
  } finally { Settings.now = originalNow; }
  facts.push('actual current/draft weekly and approval totals exclude duplicate/rejected/cancelled/unverified hours, preserve saved diagnostics and approved historical versions, and block unresolved source review without payroll/mail side effects');
}

async function testOriginalGoodsReceiptNotifications() {
  const procurement = require('../services/procurementService'), authorization = require('../services/authorizationService');
  const receiver = { id: 161, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'RECEIVE_PURCHASE_ORDER', 'INSPECT_GOODS_RECEIPT'] };
  const inspector = { id: 162, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT', 'INSPECT_GOODS_RECEIPT'] };
  const observer = { id: 163, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT'] };
  for (const [id, label, permissions, active, deleted] of [
    [receiver.id, 'receiver', receiver.permissions, 1, false], [inspector.id, 'inspector', inspector.permissions, 1, false],
    [observer.id, 'observer', observer.permissions, 1, false], [164, 'inactive-inspector', inspector.permissions, 0, false], [165, 'deleted-inspector', inspector.permissions, 1, true]
  ]) await pool.query('INSERT INTO users(id,name,username,email,password,role,permissions,active,deleted_at) VALUES(?,?,?,?,?,?,?, ?,?)',
    [id, `Synthetic goods ${label} fixture`, `synthetic-goods-${label}`, `synthetic-goods-${label}@example.invalid`, 'not-a-login-hash', 'integration_fixture', JSON.stringify(permissions), active, deleted ? new Date() : null]);
  const req = { user: receiver, ip: '127.0.0.1', id: 'synthetic-original-receipt', get: () => 'Synthetic original procurement SQL fixture' };
  const [definition] = await pool.query("INSERT INTO workflow_definitions(workflow_key,version,name,module,status,allow_self_approval) VALUES('SYNTHETIC_RECEIPT_APPROVAL',1,'Synthetic receiving fixture approval','PROCUREMENT','ACTIVE',0)");
  const [requisition] = await pool.query("INSERT INTO purchase_requisitions(requisition_no,title,currency,estimated_total,status,requested_by) VALUES('SYNTHETIC-PR-RECEIVE-001','Synthetic approved receiving fixture','AUD',110,'APPROVED',?)", [receiver.id]);
  const workflowId = crypto.randomUUID();
  const [order] = await pool.query(`INSERT INTO purchase_orders(po_number,purchase_requisition_id,supplier_id,currency,issue_date,notes,subtotal,tax_amount,total_amount,status,approval_instance_id,created_by)
    VALUES('SYNTHETIC-PO-RECEIVE-001',?,1,'AUD','2026-10-13','Synthetic private order note excluded from alerts',100,10,110,'APPROVED',?,?)`, [requisition.insertId, workflowId, receiver.id]);
  await pool.query(`INSERT INTO workflow_instances(id,definition_id,workflow_key,workflow_version,module,entity_type,entity_id,title,status,requester_id,completed_at)
    VALUES(?,?,'SYNTHETIC_RECEIPT_APPROVAL',1,'PROCUREMENT','purchase_order',?,'Synthetic approved goods receipt workflow','APPROVED',?,NOW())`, [workflowId, definition.insertId, String(order.insertId), receiver.id]);
  const [line] = await pool.query(`INSERT INTO purchase_order_items(purchase_order_id,line_no,item_code,description,quantity,unit,unit_price,tax_rate,line_subtotal,line_tax,line_total)
    VALUES(?,1,'SYNTHETIC-GOODS-01','Synthetic receiving fixture units',10,'each',10,10,100,10,110)`, [order.insertId]);
  const input = { purchase_order_id: order.insertId, received_date: '2026-10-13', delivery_reference: 'SYNTHETIC-DELIVERY-001', notes: 'Synthetic original receiving fixture', items: [{ purchase_order_item_id: line.insertId, quantity_received: '4', lot_batch_no: 'SYNTHETIC-LOT-001' }] };
  const receipt = await procurement.receiveGoods({ user: receiver, input, req });
  assert.equal(receipt.status, 'PENDING_INSPECTION'); assert.match(receipt.receipt_no, /^VV-GR-2026-\d{4,}$/);
  const [[savedReceipt]] = await pool.query('SELECT purchase_order_id,status,received_by,delivery_reference FROM goods_receipts WHERE id=?', [receipt.id]);
  assert.deepEqual(savedReceipt, { purchase_order_id: order.insertId, status: 'PENDING_INSPECTION', received_by: receiver.id, delivery_reference: input.delivery_reference });
  const [[savedLine]] = await pool.query('SELECT purchase_order_item_id,quantity_received,lot_batch_no FROM goods_receipt_items WHERE goods_receipt_id=?', [receipt.id]);
  assert.equal(savedLine.purchase_order_item_id, line.insertId); assert.equal(savedLine.quantity_received, '4.000'); assert.equal(savedLine.lot_batch_no, 'SYNTHETIC-LOT-001');
  const [[partialOrder]] = await pool.query('SELECT status FROM purchase_orders WHERE id=?', [order.insertId]); assert.equal(partialOrder.status, 'PART_RECEIVED');
  const [[receivedLine]] = await pool.query('SELECT received_quantity FROM purchase_order_items WHERE id=?', [line.insertId]); assert.equal(receivedLine.received_quantity, '4.000');
  const [eligibleAccounts] = await pool.query('SELECT id,role,permissions FROM users WHERE active=1 AND deleted_at IS NULL');
  const expectedRecipients = eligibleAccounts.filter(account => account.id !== receiver.id && authorization.hasPermission(account, 'INSPECT_GOODS_RECEIPT')).map(account => account.id).sort((a, b) => a - b);
  assert.ok(expectedRecipients.includes(inspector.id)); assert.ok(!expectedRecipients.includes(observer.id));
  const [events] = await pool.query("SELECT id,user_id,type,category,title,message,linked_module,linked_record_id,event_key FROM notifications WHERE type='goods_receipt_inspection' AND linked_record_id=? ORDER BY user_id", [String(receipt.id)]);
  assert.deepEqual(events.map(event => event.user_id), expectedRecipients, 'Persisted receiving alerts use actual saved role/permissions and active accounts only.');
  assert.ok(events.every(event => event.linked_module === 'PROCUREMENT' && event.type === 'goods_receipt_inspection' && /^[a-f0-9]{64}$/.test(event.event_key)));
  assert.ok(events.every(event => event.message.includes(receipt.receipt_no) && !event.message.includes('Synthetic private order note') && !event.message.includes('@example.invalid')), 'Inspection alerts carry the supported receipt reference without private order or account data.');
  const notificationController = require('../controllers/notificationController'), own = response(), other = response();
  await notificationController.list({ user: inspector, query: { limit: 30, page: 1 } }, own); assert.equal(own.statusCode, 200); assert.ok(own.body.notifications.some(event => event.linked_record_id === String(receipt.id)));
  const numericUnread = response(); await notificationController.unreadCount({ user: inspector }, numericUnread);
  assert.equal(numericUnread.statusCode, 200); assert.equal(numericUnread.body.unread, events.filter(event => event.user_id === inspector.id).length);
  await notificationController.list({ user: observer, query: { limit: 30, page: 1 } }, other); assert.equal(other.statusCode, 200); assert.ok(other.body.notifications.every(event => event.linked_record_id !== String(receipt.id)), 'An unrelated viewer does not receive another recipient inspection event.');
  const beforeFailure = { receipts: (await pool.query('SELECT * FROM goods_receipts WHERE purchase_order_id=? ORDER BY id', [order.insertId]))[0], lines: (await pool.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY id', [order.insertId]))[0], events };
  await assert.rejects(() => procurement.receiveGoods({ user: receiver, input: { ...input, items: [{ purchase_order_item_id: line.insertId, quantity_received: '7' }] }, req }), { code: 'OVER_RECEIPT' });
  await pool.query("UPDATE workflow_instances SET status='PENDING' WHERE id=?", [workflowId]);
  try { await assert.rejects(() => procurement.receiveGoods({ user: receiver, input: { ...input, items: [{ purchase_order_item_id: line.insertId, quantity_received: '1' }] }, req }), { code: 'APPROVAL_REQUIRED' }); }
  finally { await pool.query("UPDATE workflow_instances SET status='APPROVED' WHERE id=?", [workflowId]); }
  assert.deepEqual((await pool.query('SELECT * FROM goods_receipts WHERE purchase_order_id=? ORDER BY id', [order.insertId]))[0], beforeFailure.receipts);
  assert.deepEqual((await pool.query('SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY id', [order.insertId]))[0], beforeFailure.lines);
  assert.equal((await pool.query("SELECT COUNT(*) count FROM notifications WHERE type='goods_receipt_inspection' AND linked_record_id=?", [String(receipt.id)]))[0][0].count, events.length);
  const completed = await procurement.receiveGoods({ user: receiver, input: { ...input, delivery_reference: 'SYNTHETIC-DELIVERY-002', items: [{ purchase_order_item_id: line.insertId, quantity_received: '6' }] }, req });
  assert.notEqual(completed.id, receipt.id);
  const [[completedOrder]] = await pool.query('SELECT status FROM purchase_orders WHERE id=?', [order.insertId]); assert.equal(completedOrder.status, 'RECEIVED');
  const [[completedLine]] = await pool.query('SELECT received_quantity FROM purchase_order_items WHERE id=?', [line.insertId]); assert.equal(completedLine.received_quantity, '10.000');
  const [[receiptCount]] = await pool.query('SELECT COUNT(*) count FROM goods_receipts WHERE purchase_order_id=?', [order.insertId]); assert.equal(receiptCount.count, 2);
  assert.deepEqual(await historicalState(), historicalRows, 'Original receiving never writes the preserved bank, Finance OS, RFQ, stock or historical supplier data.');
  facts.push('real original approved PO/workflow goods receiving, partial/full order totals, scoped persisted inspection events with actual account columns, approval/over-receipt rollback and historical record preservation');
}

async function testMixedCollationNotificationOwnership() {
  const entries = require('../services/procurementEntryService'), notifications = require('../services/notificationService'), controller = require('../controllers/notificationController');
  const owner = { id: 166, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT'] }, foreign = { id: 167, role: 'integration_fixture', permissions: ['VIEW_PROCUREMENT'] };
  for (const [user, label] of [[owner, 'owner'], [foreign, 'foreign']]) await pool.query('INSERT INTO users(id,name,username,email,password,role,permissions,active) VALUES(?,?,?,?,?,?,?,1)',
    [user.id, `Synthetic collation ${label} fixture`, `synthetic-collation-${label}`, `synthetic-collation-${label}@example.invalid`, 'not-a-login-hash', user.role, JSON.stringify([...user.permissions, 'IMPORT_PROCUREMENT'])]);
  const input = { classification: 'PLAN', title: 'Synthetic notification UUID owner fixture', date: '2026-10-13', currency: 'AUD', description: 'Synthetic scoped procurement entry', quantity: '1', unit: 'ea', unit_price: '1', tax_rate: '0' };
  const ownRecord = await entries.createEntry({ user: { ...owner, permissions: [...owner.permissions, 'IMPORT_PROCUREMENT'] }, input, req: { ip: '127.0.0.1' } });
  const foreignRecord = await entries.createEntry({ user: { ...foreign, permissions: [...foreign.permissions, 'IMPORT_PROCUREMENT'] }, input: { ...input, title: 'Synthetic foreign UUID private title' }, req: { ip: '127.0.0.1' } });
  await pool.query('UPDATE users SET permissions=? WHERE id IN (?,?)', [JSON.stringify(owner.permissions), owner.id, foreign.id]);
  const [[savedOwner]] = await pool.query('SELECT role,permissions FROM users WHERE id=?', [owner.id]);
  assert.deepEqual(Array.isArray(savedOwner.permissions) ? savedOwner.permissions : JSON.parse(savedOwner.permissions), ['VIEW_PROCUREMENT'], 'Current persisted scope has no import, all-record or management permission.');
  const columnTypes = (await pool.query(`SELECT TABLE_NAME,COLUMN_NAME,COLLATION_NAME FROM information_schema.columns WHERE table_schema=DATABASE()
    AND ((table_name='procurement_records' AND column_name='id') OR (table_name='notifications' AND column_name='linked_record_id')) ORDER BY TABLE_NAME`))[0];
  assert.equal(columnTypes.length, 2); assert(columnTypes.every(column => /^utf8mb4_/.test(column.COLLATION_NAME)));
  assert.notEqual(columnTypes[0].COLLATION_NAME, columnTypes[1].COLLATION_NAME, 'This real MySQL regression retains the two original helper collations.');
  // Keep the helpers' real defaults. This is intentionally not repaired by
  // changing old tables or test columns to a common collation.
  const ownedId = await notifications.createNotification(pool, { userId: owner.id, type: 'SYNTHETIC_UUID_OWNER', category: 'SYSTEM', title: 'Synthetic owned UUID event', linkedModule: 'PROCUREMENT', linkedRecordId: ownRecord.entry.id, actionUrl: '/procurement', dedupeKey: 'synthetic-collation-owner' });
  const upperId = await notifications.createNotification(pool, { userId: owner.id, type: 'SYNTHETIC_UUID_UPPER', category: 'SYSTEM', title: 'Synthetic uppercased UUID event', linkedModule: 'PROCUREMENT', linkedRecordId: ownRecord.entry.id.toUpperCase(), actionUrl: '/procurement', dedupeKey: 'synthetic-collation-upper' });
  const hiddenId = await notifications.createNotification(pool, { userId: owner.id, type: 'SYNTHETIC_UUID_FOREIGN', category: 'SYSTEM', title: 'Synthetic foreign-owner UUID event', linkedModule: 'PROCUREMENT', linkedRecordId: foreignRecord.entry.id, actionUrl: '/procurement', dedupeKey: 'synthetic-collation-foreign' });
  const [[hiddenBefore]] = await pool.query('SELECT * FROM notifications WHERE id=?', [hiddenId]);
  const listed = response(); await controller.list({ user: owner, query: { limit: 30, page: 1 } }, listed); assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.notifications.map(event => event.id).sort((a,b) => a-b), [ownedId, upperId].sort((a,b) => a-b));
  const unread = response(); await controller.unreadCount({ user: owner }, unread); assert.equal(unread.statusCode, 200); assert.equal(unread.body.unread, 2);
  for (const id of [ownedId, upperId]) {
    const target = response(); await controller.target({ user: owner, params: { id } }, target);
    assert.equal(target.statusCode, 200); assert.equal(target.body.target_status, 'AVAILABLE'); assert.equal(target.body.target.record_id, ownRecord.entry.id);
  }
  for (const operation of ['target','open','markRead']) {
    const denied = response(); await controller[operation]({ user: owner, params: { id: hiddenId } }, denied); assert.equal(denied.statusCode, 404, 'A notification recipient still cannot access a foreign-owner UUID.');
  }
  const [[hiddenAfter]] = await pool.query('SELECT * FROM notifications WHERE id=?', [hiddenId]); assert.deepEqual(hiddenAfter, hiddenBefore);
  facts.push('real helper/default mixed-collation notification joins for numeric receipts and saved owned/uppercase/foreign UUIDs, current view-only recipient scope and fail-closed foreign read/open preservation');
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
