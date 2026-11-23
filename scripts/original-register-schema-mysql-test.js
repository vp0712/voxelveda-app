'use strict';
// This suite is isolated from the original workflow fixture database. Each CI
// matrix case receives a new, explicitly disposable schema; no cleanup drops or
// destructive schema changes are needed to test fresh and legacy upgrades.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (process.env.NODE_ENV !== 'test' || process.env.SCHEMA_DB_TEST !== 'true') throw new Error('Requires NODE_ENV=test and SCHEMA_DB_TEST=true.');
if (process.env.MYSQL_SCHEMA_TEST_DATABASE_URL) {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.MYSQL_SCHEMA_TEST_DATABASE_URL) throw new Error('Refusing a different inherited database URL.');
  process.env.DATABASE_URL = process.env.MYSQL_SCHEMA_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL) throw new Error('Refusing an inherited database URL.');
const configuration = require('../config/databaseConfig').buildDatabaseConfig(process.env).options;
if (configuration.database !== 'voxelveda_schema_test' || !['127.0.0.1','localhost','::1','mysql'].includes(configuration.host)) throw new Error('Requires local disposable voxelveda_schema_test.');
const mode = process.env.SCHEMA_FIXTURE_MODE;
if (!['fresh','upgrade'].includes(mode)) throw new Error('SCHEMA_FIXTURE_MODE must be fresh or upgrade.');
const pool = require('../config/db');
const { TABLES, assertOriginalRegisterSchemas } = require('../services/originalRegisterSchema');
const { runRetainedMigrations, RETAINED_MIGRATIONS, RETAINED_MIGRATIONS_DIR } = require('../services/retainedMigrationRunner');
const { discoverMigrations } = require('../services/migrationRunner');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originals = new Map();

async function legacyFixtures() {
  const definitions = {
    competitors: 'id INT AUTO_INCREMENT PRIMARY KEY, company_name VARCHAR(180) NOT NULL, notes TEXT NULL',
    access_attempts: 'id INT AUTO_INCREMENT PRIMARY KEY, section VARCHAR(120) NOT NULL, action VARCHAR(120) NOT NULL, method VARCHAR(20) NOT NULL, path VARCHAR(255) NOT NULL',
    customers: 'id INT AUTO_INCREMENT PRIMARY KEY, company_name VARCHAR(180) NOT NULL, email VARCHAR(180) NULL, file_link TEXT NULL',
    meetings: 'id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, meeting_date DATE NOT NULL, meeting_time TIME NOT NULL',
    app_settings: 'setting_key VARCHAR(120) PRIMARY KEY, setting_value TEXT NULL',
    announcements: 'id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL, message TEXT NOT NULL, starts_at DATE NOT NULL, expires_at DATE NOT NULL',
    staff_messages: 'id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, body TEXT NOT NULL',
    staff_work_requests: 'id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, request_type VARCHAR(40) NOT NULL, title VARCHAR(180) NOT NULL'
  };
  for (const [table, fields] of Object.entries(definitions)) await pool.query(`CREATE TABLE ${table} (${fields}) ENGINE=InnoDB`);
  await pool.query('INSERT INTO competitors(id,company_name,notes) VALUES(?,?,?)', [37, 'Original competitor Ω', 'Preserve source note exactly']);
  await pool.query("INSERT INTO access_attempts(id,section,action,method,path) VALUES(38,'original','input_denied','POST','/original')");
  await pool.query('INSERT INTO customers(id,company_name,email,file_link) VALUES(?,?,?,?)', [39,'Original customer','fixture@example.invalid','/private/original-attachment']);
  await pool.query("INSERT INTO meetings(id,title,meeting_date,meeting_time) VALUES(40,'Original meeting','2026-10-01','09:30:00')");
  await pool.query("INSERT INTO app_settings(setting_key,setting_value) VALUES('company_legal_name','Original company')");
  await pool.query("INSERT INTO announcements(id,title,message,starts_at,expires_at) VALUES(41,'Original announcement','Original message','2026-10-01','2026-11-01')");
  await pool.query("INSERT INTO staff_messages(id,user_id,body) VALUES(42,7,'Original private staff message')");
  await pool.query("INSERT INTO staff_work_requests(id,user_id,request_type,title) VALUES(43,7,'documents','Original staff request')");
  for (const table of Object.keys(definitions)) {
    const [rows] = await pool.query(`SELECT * FROM ${table}`);
    originals.set(table, { columns: Object.keys(rows[0]), hash: digest(rows) });
  }
}

async function main() {
  const [[identity]] = await pool.query('SELECT DATABASE() AS database_name');
  assert.equal(identity.database_name, 'voxelveda_schema_test');
  const [existing] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()');
  assert.equal(existing.length, 0, 'The schema migration suite requires its own fresh database.');
  if (mode === 'upgrade') await legacyFixtures();
  await pool.query('CREATE TABLE bank_accounts (id INT PRIMARY KEY, preserved_value VARCHAR(100) NOT NULL)');
  await pool.query("INSERT INTO bank_accounts(id,preserved_value) VALUES(501,'Historical retired fixture remains unchanged')");
  const archived = digest((await pool.query('SELECT * FROM bank_accounts'))[0]);
  const results = await Promise.all(Array.from({ length: 3 }, () => runRetainedMigrations({ pool, logger: { info() {} } })));
  assert.equal(results.reduce((sum, value) => sum + value.applied, 0), RETAINED_MIGRATIONS.length, 'Concurrent replicas apply each registered migration exactly once.');
  assert.equal(results.reduce((sum, value) => sum + value.skipped, 0), RETAINED_MIGRATIONS.length * 2);
  await assertOriginalRegisterSchemas(pool);
  const registeredMigrations = discoverMigrations(RETAINED_MIGRATIONS_DIR);
  const migration = registeredMigrations[0], latestMigration = '20261123_device_notices';
  assert.equal(RETAINED_MIGRATIONS.length,7,'This release contains exactly the seven reviewed additive migrations.');
  assert.equal(RETAINED_MIGRATIONS.at(-1),latestMigration);
  assert(results.every(result=>result.schema_version===latestMigration),'Every concurrent runner reports the actual latest applied schema.');
  const [allLedger]=await pool.query('SELECT migration_id,checksum_sha256,status,applied_at,started_at,updated_at FROM schema_migrations ORDER BY migration_id');
  assert.deepEqual(allLedger.map(row=>row.migration_id),[...RETAINED_MIGRATIONS],'Fresh and upgrade ledgers contain every registered migration exactly once.');
  for(const [index,row]of allLedger.entries()){assert.equal(row.status,'APPLIED');assert.equal(row.checksum_sha256,registeredMigrations[index].checksum_sha256);assert(row.applied_at);}
  const ledgerDigest=digest(allLedger);
  const [[ledger]] = await pool.query('SELECT migration_id,checksum_sha256,status,applied_at,started_at,updated_at FROM schema_migrations WHERE migration_id=?', [RETAINED_MIGRATIONS[0]]);
  assert.equal(ledger.status, 'APPLIED'); assert.equal(ledger.checksum_sha256, migration.checksum_sha256);
  const repeated = await runRetainedMigrations({ pool, logger: { info() {} } });
  assert.equal(repeated.applied, 0); assert.equal(repeated.skipped, RETAINED_MIGRATIONS.length);
  assert.equal(repeated.schema_version,latestMigration);
  // Exercise persisted metadata in actual MySQL using a private-object-store
  // adapter fixture. Provider connectivity is verified separately in production.
  // No PDF BLOB, local file, recipient or email queue is involved.
  const pdfs = require('../services/timesheetPdfService');
  const pdfObjects=new Map(),pdfStorage={async putObject(key,buffer,type){assert.equal(type,'application/pdf');pdfObjects.set(key,Buffer.from(buffer));},async getObject(key){assert(pdfObjects.has(key));return Buffer.from(pdfObjects.get(key));},async deleteObject(key){pdfObjects.delete(key);}};
  const cachedArtifact=(db,snapshot)=>pdfs.snapshotArtifact(db,snapshot,null,pdfStorage);
  const pdfSnapshot = { staff_id: 901, staff_name: 'Migration PDF fixture', employee_reference: 'FIXTURE-901',
    period_start: '2026-10-19', period_end: '2026-10-25', timezone: 'Australia/Sydney', version: 1,
    review_status: 'DRAFT', review_version: 0, approval_verified: false, total_minutes: 480,
    generated_at: '2026-10-26T01:00:00.000Z', shift_allocation: 'WHOLE_SHIFT_LOCAL_START_DATE',
    rows: [{ id: 901, user_id: 901, work_date: '2026-10-20', clock_in: '2026-10-19T22:00:00Z', clock_out: '2026-10-20T06:30:00Z', total_minutes: 480, total_hours: 8, break_minutes: 30 }] };
  const frozenPdf = await pdfs.freezeSnapshot(pool, pdfSnapshot);
  const artifacts = await Promise.all([cachedArtifact(pool, frozenPdf), cachedArtifact(pool, frozenPdf)]);
  assert(artifacts[0].buffer.equals(artifacts[1].buffer), 'Independent producers converge on the persisted first PDF.');
  const reopened = await pool.getConnection();
  try {
    const [[storedPdf]] = await reopened.query('SELECT pdf_object_key,pdf_bytes_count,pdf_sha256,pdf_filename FROM timesheet_pdf_snapshots WHERE source_key=?', [pdfs.sourceKey(frozenPdf)]);
    assert((await pdfStorage.getObject(storedPdf.pdf_object_key)).equals(artifacts[0].buffer));assert.equal(storedPdf.pdf_bytes_count,artifacts[0].buffer.length);
    assert.equal(storedPdf.pdf_sha256, artifacts[0].validation.sha256); assert.match(storedPdf.pdf_filename, /\.pdf$/);
    const restoredPdf = await pdfs.freezeSnapshot(reopened, { ...pdfSnapshot, generated_at: '2026-10-27T01:00:00.000Z' });
    assert.equal(restoredPdf.generated_at, pdfSnapshot.generated_at, 'A later process preserves the original source timestamp.');
    assert((await cachedArtifact(reopened, restoredPdf)).buffer.equals(artifacts[0].buffer));
  } finally { reopened.release(); }
  let snapshotReaders=0,releaseSnapshotReaders;
  const snapshotReadersReady=new Promise(resolve=>{releaseSnapshotReaders=resolve;});
  const racingSnapshots=await Promise.all([0,1].map(async index=>{
    const connection=await pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction();
      await connection.query('SELECT COUNT(*) AS total FROM timesheet_pdf_snapshots');
      if(++snapshotReaders===2)releaseSnapshotReaders();await snapshotReadersReady;
      const result=await pdfs.freezeSnapshot(connection,{...pdfSnapshot,version:2,generated_at:`2026-10-26T0${index+2}:00:00.000Z`});
      await connection.commit();return result;
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }));
  assert.deepEqual(racingSnapshots[0],racingSnapshots[1],'A stale REPEATABLE READ snapshot sees the concurrent committed source winner through the locking read.');
  const [[unchanged]] = await pool.query('SELECT migration_id,checksum_sha256,status,applied_at,started_at,updated_at FROM schema_migrations WHERE migration_id=?', [RETAINED_MIGRATIONS[0]]);
  assert.equal(digest(unchanged), digest(ledger), 'A restart does not rewrite completed migration evidence.');
  for (const [table, original] of originals) {
    const selection = original.columns.map(column => '`' + column + '`').join(',');
    assert.equal(digest((await pool.query(`SELECT ${selection} FROM ${table}`))[0]), original.hash, table + ' original values and IDs survive upgrade');
  }
  if (mode === 'upgrade') {
    const [[legacy]] = await pool.query('SELECT created_at,source_type,created_by FROM competitors WHERE id=37');
    assert.equal(legacy.created_at, null); assert.equal(legacy.source_type, null); assert.equal(legacy.created_by, null, 'Missing historical ownership is never invented');
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-mysql-checksum-'));
  try {
    for (const entry of discoverMigrations(RETAINED_MIGRATIONS_DIR)) fs.copyFileSync(entry.filename, path.join(temp, entry.migration_id + '.sql'));
    fs.writeFileSync(path.join(temp, RETAINED_MIGRATIONS[0] + '.sql'), fs.readFileSync(migration.filename, 'utf8') + '\n-- changed applied checksum fixture\n');
    await assert.rejects(runRetainedMigrations({ pool, migrationsDir: temp, logger: { info() {} } }), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  assert.equal(digest((await pool.query('SELECT * FROM bank_accounts'))[0]), archived, 'No retired table or historical record is changed');
  const [tables] = await pool.query('SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema=DATABASE()');
  const weeklyTables = ['weekly_timesheet_deliveries','weekly_timesheet_delivery_versions'];
  const noticeTables = ['ai_team_events','ai_team_recipients','ai_team_preferences','notice_installations','notice_releases','notice_deliveries'];
  const expectedTables = [...Object.keys(TABLES), 'timesheet_pdf_snapshots', 'manual_report_snapshots', 'timesheet_edit_receipts', 'schema_migrations', 'bank_accounts', ...weeklyTables, ...noticeTables].sort();
  assert.deepEqual(tables.map(table => table.table_name).sort(), expectedTables,
    'Only the exact retained tables and reviewed additive notice tables exist.');
  const [receiptColumns]=await pool.query("SELECT column_name AS column_name,data_type AS data_type,is_nullable AS is_nullable,character_maximum_length AS max_length,character_set_name AS character_set_name,collation_name AS collation_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='timesheet_edit_receipts' ORDER BY ordinal_position");
  assert.deepEqual(receiptColumns.map(column=>column.column_name),['timesheet_id','request_id','payload_sha256','response_json','version_no','created_by','created_at'],'The receipt stores only its reviewed durable request/result/version/actor metadata.');
  assert(receiptColumns.every(column=>column.is_nullable==='NO'&&!/blob|binary/.test(column.data_type)),'Receipt fields are required metadata, without document BLOB storage.');
  assert.deepEqual(receiptColumns.map(column=>column.data_type),['int','char','char','longtext','int','int','datetime']);
  for(const [name,length]of [['request_id',36],['payload_sha256',64]]){const column=receiptColumns.find(item=>item.column_name===name);assert.equal(Number(column.max_length),length);assert.equal(column.character_set_name,'ascii');assert.equal(column.collation_name,'ascii_bin');}
  const [receiptPrimary]=await pool.query("SELECT column_name AS column_name,non_unique AS non_unique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='timesheet_edit_receipts' AND index_name='PRIMARY' ORDER BY seq_in_index");
  assert.deepEqual(receiptPrimary.map(column=>column.column_name),['timesheet_id','request_id'],'Durable retries are uniquely identified by the saved sheet and request UUID.');
  assert(receiptPrimary.every(column=>Number(column.non_unique)===0));
  const [receiptActor]=await pool.query("SELECT column_name AS column_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='timesheet_edit_receipts' AND index_name='idx_timesheet_edit_actor' ORDER BY seq_in_index");
  assert.deepEqual(receiptActor.map(column=>column.column_name),['created_by','created_at']);
  const requestId='ea69c23f-603a-49ae-ae07-7798e7ceea61',payloadHash=crypto.createHash('sha256').update('Synthetic immutable correction payload').digest('hex');
  const receiptBody=JSON.stringify({outcome:'COMMITTED',request_id:requestId,timesheet:{id:901,user_id:902,status:'FINAL',version_no:2,final_hours:7.5},attendance:{id:903,revision:2}});
  await pool.query('INSERT INTO timesheet_edit_receipts(timesheet_id,request_id,payload_sha256,response_json,version_no,created_by) VALUES(?,?,?,?,?,?)',[901,requestId,payloadHash,receiptBody,2,904]);
  const [[originalReceipt]]=await pool.query('SELECT * FROM timesheet_edit_receipts WHERE timesheet_id=? AND request_id=?',[901,requestId]);
  await assert.rejects(pool.query('INSERT INTO timesheet_edit_receipts(timesheet_id,request_id,payload_sha256,response_json,version_no,created_by) VALUES(?,?,?,?,?,?)',[901,requestId,'f'.repeat(64),'changed result must not overwrite',3,905]),error=>error.code==='ER_DUP_ENTRY','Concurrent/replayed request identities cannot create a second receipt or overwrite the first result.');
  const receiptRestart=await runRetainedMigrations({pool,logger:{info(){}}});assert.equal(receiptRestart.applied,0);assert.equal(receiptRestart.skipped,7);assert.equal(receiptRestart.schema_version,latestMigration);
  const reopenedReceipt=await pool.getConnection();
  try{const [[preservedReceipt]]=await reopenedReceipt.query('SELECT * FROM timesheet_edit_receipts WHERE timesheet_id=? AND request_id=?',[901,requestId]);assert.equal(digest(preservedReceipt),digest(originalReceipt),'Fresh/upgrade schema restarts preserve exact receipt identity, payload hash, result bytes, actor, version and creation time.');assert.equal(preservedReceipt.response_json,receiptBody);}finally{reopenedReceipt.release();}
  const [unchangedLedger]=await pool.query('SELECT migration_id,checksum_sha256,status,applied_at,started_at,updated_at FROM schema_migrations ORDER BY migration_id');assert.equal(digest(unchangedLedger),ledgerDigest,'Applied migration checksums and timestamps survive repeat startup unchanged.');
  assert.equal(digest((await pool.query('SELECT * FROM bank_accounts'))[0]),archived,'Receipt retry/schema verification does not alter retired data.');
  const [manualColumns]=await pool.query("SELECT column_name AS column_name,data_type AS data_type,is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='manual_report_snapshots' ORDER BY ordinal_position");
  assert.deepEqual(manualColumns.map(column=>column.column_name),['id','created_by','source_type','descriptor_json','document_json','authority_sha256','source_sha256','pdf_storage_key','pdf_sha256','pdf_pages','filename','created_at']);
  assert(manualColumns.every(column=>column.is_nullable==='NO'&&!/blob|binary/.test(column.data_type)),'Manual PDFs stay in existing private object storage; SQL stores required immutable metadata only.');
  const [manualIndex]=await pool.query("SELECT column_name AS column_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='manual_report_snapshots' AND index_name='idx_manual_report_authority' ORDER BY seq_in_index");
  assert.deepEqual(manualIndex.map(column=>column.column_name),['created_by','authority_sha256'],'Cross-intent delivery reconciliation uses an indexed actor/source lookup.');
  const [htmlColumns] = await pool.query(`SELECT table_name AS table_name,column_name AS column_name,data_type AS data_type,
    is_nullable AS is_nullable,column_default AS column_default,character_maximum_length AS max_length
    FROM information_schema.columns WHERE table_schema=DATABASE()
      AND table_name IN (?,?) AND column_name IN (?,?,?)`,
  [...weeklyTables, 'delivery_format', 'content_sha256', 'content_snapshot_json']);
  const expectedColumnNames = weeklyTables.flatMap(table => ['delivery_format','content_sha256','content_snapshot_json'].map(column => table + '.' + column)).sort();
  assert.deepEqual(htmlColumns.map(column => column.table_name + '.' + column.column_name).sort(), expectedColumnNames,
    'Both current and immutable historical versions have all six explicit HTML metadata fields.');
  for (const column of htmlColumns) {
    if (column.column_name === 'delivery_format') {
      assert.equal(column.data_type, 'varchar');assert.equal(Number(column.max_length), 16);
      assert.equal(column.is_nullable, 'NO');assert.equal(column.column_default, 'PDF', 'Legacy rows retain PDF semantics; HTML is selected explicitly by the new scheduler.');
    } else {
      assert.equal(column.is_nullable, 'YES');assert.equal(column.column_default, null, 'Migration must not invent a content hash or rendered historical body.');
      assert.equal(column.data_type, column.column_name === 'content_sha256' ? 'char' : 'longtext');
      if (column.column_name === 'content_sha256') assert.equal(Number(column.max_length), 64);
    }
  }
  console.log(JSON.stringify({ result: 'passed', fixture_mode: mode, original_tables: Object.keys(TABLES).length, exact_schema_tables: expectedTables.length, weekly_html_metadata_columns: htmlColumns.length, receipt_primary_columns: receiptPrimary.map(column=>column.column_name), immutable_receipt_preserved: true, applied_schema_version: latestMigration, migration_count: allLedger.length, concurrent_runners: 3, applied_once: true, checksummed: true, historical_values_preserved: true, retired_table_unchanged: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
