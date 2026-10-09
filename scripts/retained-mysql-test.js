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

const pool = require('../config/db');
const fixtureDirectory = path.join(__dirname, '..', 'uploads', `.retained-mysql-${crypto.randomUUID()}`);
const capturedMessages = [];
let originalSendMail;
const facts = [];
const retiredDocumentId = crypto.randomUUID();
const retiredGrantId = crypto.randomUUID();
const retiredGrantToken = crypto.randomBytes(32).toString('base64url');
let historicalRows;

function digest(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
    end(body) { this.body = body; return this; }
  };
}

async function historicalState() {
  const tables = ['bank_accounts', 'bank_transactions', 'finance_report_snapshot_chunks', 'invoices', 'suppliers'];
  const result = {};
  for (const table of tables) result[table] = digest((await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]);
  const [[audit]] = await pool.query(`SELECT id,actor_id,action,module,record_id,old_value,new_value,created_at,previous_integrity_hash,integrity_hash FROM audit_logs WHERE id=1`);
  result.audit = digest(audit);
  const [[document]] = await pool.query('SELECT * FROM secure_documents WHERE id=?', [retiredDocumentId]);
  result.document = digest(document);
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
    id INT PRIMARY KEY, name VARCHAR(120), email VARCHAR(180), password VARCHAR(255),
    role VARCHAR(40), permissions JSON, active TINYINT DEFAULT 1, deleted_at DATETIME NULL
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO users VALUES
    (20,'Fixture owner','owner@example.invalid','not-a-login-hash','viewer',JSON_ARRAY(),1,NULL),
    (21,'Other customer','other@example.invalid','not-a-login-hash','viewer',JSON_ARRAY(),1,NULL)`);
  await pool.query(`CREATE TABLE rfqs (
    id INT AUTO_INCREMENT PRIMARY KEY, customer_name VARCHAR(120) NOT NULL,
    email VARCHAR(180) NOT NULL, phone VARCHAR(40), material VARCHAR(120), quantity INT,
    application TEXT, status VARCHAR(30), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  await pool.query(`INSERT INTO rfqs(customer_name,email,phone,material,quantity,application,status)
    VALUES ('Historical enquiry','history@example.invalid','','Steel',2,'Preserve this enquiry','approved')`);

  // Representative historical data survives code retirement, including encrypted
  // snapshot bytes. These are synthetic fixtures, never copied production data.
  await pool.query(`CREATE TABLE bank_accounts(id INT PRIMARY KEY,created_by INT,nickname VARCHAR(100),currency CHAR(3),encrypted_details BLOB)`);
  await pool.query(`CREATE TABLE bank_transactions(id INT PRIMARY KEY,bank_account_id INT,transaction_date DATE,debit DECIMAL(18,2),credit DECIMAL(18,2),currency CHAR(3))`);
  await pool.query(`CREATE TABLE finance_report_snapshot_chunks(id INT PRIMARY KEY,report_uid VARCHAR(80),content LONGBLOB)`);
  await pool.query(`CREATE TABLE invoices(id INT PRIMARY KEY,customer_id INT,total DECIMAL(18,2),status VARCHAR(30))`);
  await pool.query(`CREATE TABLE suppliers(id INT PRIMARY KEY,name VARCHAR(120),private_note TEXT)`);
  await pool.query('INSERT INTO bank_accounts VALUES(1,20,?, ?, ?)', ['Separate bank identity', 'AUD', Buffer.from([0, 255, 19, 128, 44])]);
  await pool.query("INSERT INTO bank_transactions VALUES(1,1,'2026-09-30',76.80,0,'AUD'),(2,1,'2026-10-01',0,120.40,'AUD')");
  await pool.query('INSERT INTO finance_report_snapshot_chunks VALUES(1,?,?)', ['RPT_fixture_historical', crypto.randomBytes(8192)]);
  await pool.query("INSERT INTO invoices VALUES(1,30,176.80,'unpaid')");
  await pool.query("INSERT INTO suppliers VALUES(1,'Historical supplier','Preserve ownership and private records')");
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
  await pool.query(`INSERT INTO document_download_grants(id,document_id,token_hash,bound_user_id,created_by,expires_at)
    VALUES(?,?,?,?,20,DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
  [retiredGrantId, retiredDocumentId, digest(Buffer.from(retiredGrantToken)), 20]);
  historicalRows = await historicalState();
}

async function initializeRetainedSchemas() {
  // The same retained schema services used by server.bootstrap, run twice to
  // exercise additive initialization on an existing historical installation.
  const initializers = [
    require('../services/securitySchema').ensureSecuritySchema,
    require('../services/securityOperationsSchema').ensureSecurityOperationsSchema,
    require('../services/operationalTrustSchema').ensureOperationalTrustSchema,
    require('../services/securityGovernanceSchema').ensureSecurityGovernanceSchema,
    require('../services/emailQueueSchema').ensureEmailQueueSchema
  ];
  for (const initialize of initializers) await initialize();
  for (const initialize of initializers) await initialize();
  assert.deepEqual(await historicalState(), historicalRows, 'Retained startup must preserve historical ledgers, documents, grants and audit values.');
  facts.push('additive retained startup preserves historical records and encrypted snapshot bytes');
}

async function testRfq() {
  const controller = require('../controllers/publicRfqController');
  const publicBody = {
    customer_name: "Enquiry'); UPDATE rfqs SET status='approved'; --",
    email: 'fixture@example.invalid', phone: '+61 400 000 000', material: 'Steel',
    quantity: '3', application: '<script>untrusted customer text</script>'
  };
  const result = response();
  await controller.createRFQ({ body: publicBody, headers: {} }, result);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.rfq_id > 1);
  const [[saved]] = await pool.query('SELECT * FROM rfqs WHERE id=?', [result.body.rfq_id]);
  assert.equal(saved.customer_name, publicBody.customer_name);
  assert.equal(saved.application, publicBody.application);
  assert.equal(saved.quantity, 3);
  assert.equal(saved.status, 'pending', 'Public input cannot approve an enquiry.');
  const [[historical]] = await pool.query('SELECT status,application FROM rfqs WHERE id=1');
  assert.deepEqual({ ...historical }, { status: 'approved', application: 'Preserve this enquiry' });

  for (const body of [{ ...publicBody, status: 'approved' }, { ...publicBody, rfq_id: 1 }, { ...publicBody, quantity: 0 }, { ...publicBody, role: 'admin' }]) {
    const invalid = response();
    await controller.createRFQ({ body, headers: {} }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  const [[count]] = await pool.query('SELECT COUNT(*) AS count FROM rfqs');
  assert.equal(count.count, 2, 'Rejected requests must not create records.');
  facts.push('actual RFQ controller persists pending-only parameterized enquiries without changing historical RFQs');
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
  const owner = { id: 20, role: 'viewer', permissions: [] };
  const other = { id: 21, role: 'viewer', permissions: [] };
  const body = Buffer.from([0, 255, 128, 10, 13, 60, 0, 250]);
  const file = await fileFixture('customer-enquiry.bin', body);
  const saved = await documents.registerDocument({ module: 'rfq', recordType: 'customer_enquiry', recordId: '2', ownerUserId: 20, uploadedBy: 20, file });
  assert.equal((await documents.getAuthorisedDocument(owner, saved.id)).status, 200);
  assert.equal((await documents.getAuthorisedDocument(other, saved.id)).status, 403, 'A different customer cannot read the owner attachment.');
  assert.equal((await documents.getAuthorisedDocument({ ...other, permissions: ['VIEW_RFQS'] }, saved.id)).status, 200);
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
  assert.deepEqual(await historicalState(), historicalRows, 'Read/grant/delete attempts must leave retired documents, grants and historical records untouched.');
  facts.push('stored customer document bytes, owner isolation and user-bound grants; retired owner/admin/public/internal access remains denied without mutation');
}

async function testQueue() {
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
  for (const module of ['finance', 'timesheets', 'erp', null]) {
    const [insert] = await pool.query(`INSERT INTO email_queue(to_json,subject,attachments_json,related_module,status,scheduled_at,idempotency_key)
      VALUES(?,?,?,?,'PENDING','2000-01-01',?)`,
    [JSON.stringify(['historical@example.invalid']), 'Retired message to preserve', JSON.stringify([{ filename: 'historical.pdf', content: 'retain-exact-content' }]), module, `historical-${module}`]);
    retiredRows.push(insert.insertId);
  }
  const queryRetired = () => pool.query(`SELECT * FROM email_queue WHERE id IN (${retiredRows.map(() => '?').join(',')}) ORDER BY id`, retiredRows);
  const retiredBefore = digest((await queryRetired())[0]);
  const bytes = Buffer.concat([Buffer.from([0, 255, 128, 10, 13, 60, 0, 250]), Buffer.from('UTF-8 enquiry: \u00a3 \u20ac \ud83d\udce7')]);
  const temporary = await fileFixture('temporary-upload.bin', bytes);
  const message = { relatedModule: 'customer_rfqs', relatedRecordId: '2', to: ['fixture@example.invalid'], subject: 'Disposable queue test',
    text: 'No real email transport is called.', scheduledAt: new Date('2000-01-01T00:00:00Z'), idempotencyKey: 'retained-mysql-queue',
    attachments: [{ path: temporary.path, filename: 'customer-enquiry.bin', contentType: 'application/octet-stream', contentDisposition: 'attachment' }] };
  const id = await queue.queueEmail(message);
  assert.equal(await queue.queueEmail(message), id, 'Actual unique-key handling prevents duplicate queue entries.');
  await fs.promises.unlink(temporary.path);
  const [[stored]] = await pool.query('SELECT attachments_json FROM email_queue WHERE id=?', [id]);
  assert.doesNotMatch(stored.attachments_json, /temporary-upload|\/uploads\//, 'Durable content cannot rely on a removed upload path.');
  const attachment = JSON.parse(stored.attachments_json)[0];
  assert.equal(attachment.filename, 'customer-enquiry.bin');
  assert.equal(attachment.byteLength, bytes.length);
  assert.equal(attachment.sha256, digest(bytes));

  // Simulate a fresh module/worker after the original upload has disappeared.
  delete require.cache[require.resolve('../services/emailQueue')];
  delete require.cache[require.resolve('../services/emailQueueSchema')];
  queue = require('../services/emailQueue');
  assert.deepEqual(await queue.processEmailQueue(50), [{ id, status: 'SENT' }]);
  assert.equal(capturedMessages.length, 1);
  assert.deepEqual(capturedMessages[0].attachments[0].content, bytes);
  assert.equal(capturedMessages[0].attachments[0].filename, 'customer-enquiry.bin');
  assert.equal(capturedMessages[0].attachments[0].contentType, 'application/octet-stream');
  assert.equal(capturedMessages[0].attachments[0].contentDisposition, 'attachment');
  assert.deepEqual(await queue.processEmailQueue(50), []);
  assert.equal(digest((await queryRetired())[0]), retiredBefore, 'Retired and unclassified queue rows remain byte-for-byte intact and unclaimed.');
  for (const relatedModule of ['finance', 'timesheets', 'erp', undefined]) {
    await assert.rejects(() => queue.queueEmail({ ...message, relatedModule, attachments: [] }), { code: 'EMAIL_MODULE_RETIRED' });
  }
  const [[log]] = await pool.query('SELECT * FROM email_logs WHERE queue_id=?', [id]);
  assert.equal(log.status, 'SENT');
  assert.equal(log.provider_message_id, 'fixture-accepted-1');
  facts.push('actual queue SQL preserves retired rows, idempotency and binary attachments after upload deletion and module restart; transport is safely mocked');
}

async function main() {
  await prepareFixtures();
  await initializeRetainedSchemas();
  await testRfq();
  await testAudit();
  await testDocuments();
  await testQueue();
  assert.deepEqual(await historicalState(), historicalRows, 'All retained workflows preserve historical retired data.');
  console.log(`MYSQL_RETAINED_OK: ${facts.join('; ')}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (originalSendMail) require('../services/emailService').sendMail = originalSendMail;
  await fs.promises.rm(fixtureDirectory, { recursive: true, force: true });
  await pool.end();
});
