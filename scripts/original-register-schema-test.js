'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../services/originalRegisterSchema');
const migrations = require('../services/retainedMigrationRunner');
const { discoverMigrations } = require('../services/migrationRunner');

function columns(table) {
  return schema.TABLES[table].map(column_name => ({ column_name,
    column_key: column_name === (table === 'app_settings' ? 'setting_key' : 'id') ? 'PRI' : '',
    data_type: column_name === 'id' ? 'int' : 'varchar', extra: column_name === 'id' ? 'auto_increment' : '' }));
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

async function main() {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    assert.match(sql, /^SELECT /);
    return [columns(params[0])];
  } };
  await Promise.all(Array.from({ length: 24 }, () => schema.assertOriginalRegisterSchema('competitors', db)));
  assert.equal(queries.length, 1, 'Concurrent requests share one read-only observation');
  await schema.assertOriginalRegisterSchemas(db);
  await schema.assertOriginalRegisterSchemas(db);
  assert.equal(queries.length, Object.keys(schema.TABLES).length, 'Successful schema observations do not repeat per request');
  assert.throws(() => schema.assertOriginalRegisterSchema('bank_accounts', db), /Unsupported original register/);

  let attempts = 0;
  const retryDb = { async query() { attempts++; if (attempts === 1) throw Object.assign(new Error('Internal provider details'), { code: 'ER_ACCESS_DENIED_ERROR' }); return [columns('competitors')]; } };
  await assert.rejects(schema.assertOriginalRegisterSchema('competitors', retryDb), error => error.code === 'ORIGINAL_REGISTER_SCHEMA_CHECK_FAILED' && error.statusCode === 503 && error.details.cause_code === 'ER_ACCESS_DENIED_ERROR' && !error.message.includes('Internal provider'));
  await schema.assertOriginalRegisterSchema('competitors', retryDb);
  assert.equal(attempts, 2, 'Failed observations can be retried after recovery');
  for (const broken of [columns('competitors').filter(row => row.column_name !== 'company_name'), columns('competitors').map(row => row.column_name === 'id' ? { ...row, column_key: '' } : row)]) {
    await assert.rejects(schema.assertOriginalRegisterSchema('competitors', { async query() { return [broken]; } }), { code: 'ORIGINAL_REGISTER_SCHEMA_NOT_READY', statusCode: 503 });
  }

  const statements = migrations.validateRetainedMigrations();
  assert.deepEqual(statements.map(entry => entry.migration_id), [...migrations.RETAINED_MIGRATIONS]);
  assert.match(statements[0].checksum_sha256, /^[a-f0-9]{64}$/);
  const sql = fs.readFileSync(statements[0].filename, 'utf8');
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(match => match[1]).sort(), Object.keys(schema.TABLES).sort());
  assert.ok(!discoverMigrations().some(entry => migrations.RETAINED_MIGRATIONS.includes(entry.migration_id)), 'Historical discovery cannot replay current migrations or retired SQL');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-retained-schema-policy-'));
  try {
    const name = migrations.RETAINED_MIGRATIONS[0] + '.sql';
    fs.writeFileSync(path.join(dir, name), sql + '\nDELETE FROM bank_accounts;\n');
    assert.throws(() => migrations.validateRetainedMigrations(dir), { code: 'RETAINED_MIGRATION_NOT_ADDITIVE' });
    fs.writeFileSync(path.join(dir, name), sql);
    fs.writeFileSync(path.join(dir, '20261026_unregistered.sql'), 'CREATE TABLE IF NOT EXISTS unexpected (id INT);\n');
    assert.throws(() => migrations.validateRetainedMigrations(dir), { code: 'RETAINED_MIGRATION_NOT_REGISTERED' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const files = {
    'controllers/competitorController.js': ['ensureCompetitorTable'], 'controllers/accessAttemptController.js': ['ensureAccessAttemptTable'],
    'controllers/customerController.js': ['ensureCustomerTable'], 'controllers/meetingController.js': ['ensureMeetingTable'],
    'controllers/settingsController.js': ['ensureSettingsTable'], 'controllers/taskController.js': ['ensureAnnouncementTable','ensureStaffMessageTable','ensureStaffWorkRequestTable'],
    'middleware/inputPermissionMiddleware.js': ['ensureAccessAttemptTable']
  };
  for (const [file, names] of Object.entries(files)) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const name of names) {
      const body = source.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{([^}]+)\\}'))?.[1];
      assert(body, file + ':' + name);
      assert.match(body, /assertOriginalRegisterSchema/);
      assert.doesNotMatch(body, /CREATE|ALTER|DROP|TRUNCATE/);
    }
  }
  const attendance = fs.readFileSync(path.join(__dirname, '../controllers/attendanceController.js'), 'utf8');
  assert.match(attendance, /if \(!originalSchemaPromise\) originalSchemaPromise = createAttendanceTablesStructures/);

  const controllerFile = path.join(__dirname, '../controllers/competitorController.js');
  const fake = { exports: {} }, failingDb = { async query() { return [[]]; } };
  vm.runInNewContext(fs.readFileSync(controllerFile, 'utf8'), { exports: fake.exports, module: fake, console: { error() {} }, require(name) {
    if (name === '../config/db') return failingDb;
    if (name === '../services/originalRegisterSchema') return schema;
    if (name === '../utils/externalHttpUrl') return require('../utils/externalHttpUrl');
    throw new Error(name);
  } }, { filename: controllerFile });
  const res = response(); await fake.exports.getCompetitors({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'ORIGINAL_REGISTER_SCHEMA_NOT_READY');
  assert.equal(res.body.details, undefined, 'Internal schema details do not leak through the request response');
  console.log('Original register schema tests passed: nine request helpers read only; concurrent memoisation and recovery; identity checks; scoped ordered additive migrations; retired SQL never replayed; clear startup/request failure.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
