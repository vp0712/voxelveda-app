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
  const migration = discoverMigrations(RETAINED_MIGRATIONS_DIR)[0];
  const [[ledger]] = await pool.query('SELECT migration_id,checksum_sha256,status,applied_at,started_at,updated_at FROM schema_migrations WHERE migration_id=?', [RETAINED_MIGRATIONS[0]]);
  assert.equal(ledger.status, 'APPLIED'); assert.equal(ledger.checksum_sha256, migration.checksum_sha256);
  const repeated = await runRetainedMigrations({ pool, logger: { info() {} } });
  assert.equal(repeated.applied, 0); assert.equal(repeated.skipped, RETAINED_MIGRATIONS.length);
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
  const [tables] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()');
  assert.equal(tables.length, Object.keys(TABLES).length + 3, 'Only current original tables, the private timesheet PDF cache, the migration ledger and the protected retired fixture exist.');
  console.log(JSON.stringify({ result: 'passed', fixture_mode: mode, original_tables: Object.keys(TABLES).length, concurrent_runners: 3, applied_once: true, checksummed: true, historical_values_preserved: true, retired_table_unchanged: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
