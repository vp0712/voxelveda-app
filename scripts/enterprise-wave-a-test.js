const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildDatabaseConfig, parseDatabaseUrl } = require('../config/databaseConfig');
const {
  CONTROL_STATES,
  detailedReadiness,
  markReady,
  publicReadiness,
  resetRuntimeState,
  setControl,
  setDatabase,
  setMigrations
} = require('../services/runtimeState');
const { discoverMigrations, runMigrations, splitMigrationSql } = require('../services/migrationRunner');

function migrationPool() {
  const ledger = new Map();
  const executed = [];
  let lockHeld = false;
  const connection = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT GET_LOCK')) {
        lockHeld = true;
        return [[{ acquired: 1 }], []];
      }
      if (normalized.startsWith('SELECT RELEASE_LOCK')) {
        lockHeld = false;
        return [[{ released: 1 }], []];
      }
      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) return [[], []];
      if (normalized.startsWith('SELECT migration_id, checksum_sha256, status FROM schema_migrations')) {
        const row = ledger.get(params[0]);
        return [row ? [row] : [], []];
      }
      if (normalized.startsWith('INSERT INTO schema_migrations')) {
        ledger.set(params[0], { migration_id: params[0], checksum_sha256: params[1], status: 'RUNNING' });
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith("UPDATE schema_migrations SET status = 'APPLIED'")) {
        const id = params[2];
        ledger.set(id, { ...ledger.get(id), status: 'APPLIED' });
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith("UPDATE schema_migrations SET status = 'FAILED'")) return [{ affectedRows: 1 }, []];
      if (normalized.startsWith('SELECT migration_id FROM schema_migrations')) {
        const latest = [...ledger.values()].filter((row) => row.status === 'APPLIED').sort((a, b) => b.migration_id.localeCompare(a.migration_id))[0];
        return [latest ? [{ migration_id: latest.migration_id }] : [], []];
      }
      executed.push(normalized);
      return [{ affectedRows: 1 }, []];
    },
    release() {}
  };
  return {
    ledger,
    executed,
    get lockHeld() { return lockHeld; },
    pool: { getConnection: async () => connection }
  };
}

async function testMigrationRunner() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voxelveda-wave-a-'));
  try {
    fs.writeFileSync(path.join(directory, '20260101_first.sql'), 'CREATE TABLE first_table (id INT);\n');
    fs.writeFileSync(path.join(directory, '20260102_second.sql'), 'INSERT INTO first_table (id) VALUES (1);\n');
    const mock = migrationPool();
    const first = await runMigrations({ pool: mock.pool, migrationsDir: directory, logger: { info() {} }, env: { DEPLOYMENT_SHA: 'test-sha' } });
    assert.equal(first.applied, 2);
    assert.equal(first.schema_version, '20260102_second');
    assert.equal(mock.executed.length, 2);
    assert.equal(mock.lockHeld, false);

    const second = await runMigrations({ pool: mock.pool, migrationsDir: directory, logger: { info() {} } });
    assert.equal(second.applied, 0);
    assert.equal(second.skipped, 2);

    fs.writeFileSync(path.join(directory, '20260101_first.sql'), 'CREATE TABLE first_table (id BIGINT);\n');
    await assert.rejects(
      () => runMigrations({ pool: mock.pool, migrationsDir: directory, logger: { info() {} } }),
      (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function testSqlParser() {
  const sql = `
DELIMITER $$
CREATE PROCEDURE vv_test()
BEGIN
  SELECT 1;
END$$
DELIMITER ;
CALL vv_test();
DROP PROCEDURE vv_test;
`;
  const statements = splitMigrationSql(sql);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE PROCEDURE/);
  assert.match(statements[1], /CALL vv_test/);
  const repositoryMigrations = discoverMigrations();
  assert(repositoryMigrations.length >= 20);
  assert(repositoryMigrations.every((migration) => Array.isArray(migration.statements)));
}

function testDatabaseConfiguration() {
  const parsed = parseDatabaseUrl('mysqls://app%40user:p%40ss@db.example.com:3307/voxel%5Fveda');
  assert.equal(parsed.user, 'app@user');
  assert.equal(parsed.password, 'p@ss');
  assert.equal(parsed.database, 'voxel_veda');
  assert.equal(parsed.tlsFromUrl, true);

  const config = buildDatabaseConfig({
    DATABASE_URL: 'mysql://app:password@db.example.com/voxelveda',
    DB_TLS_REQUIRED: 'true',
    DB_TLS_REJECT_UNAUTHORIZED: 'true'
  });
  assert.equal(config.summary.source, 'DATABASE_URL');
  assert.equal(config.options.ssl.rejectUnauthorized, true);
  assert.equal(config.summary.tls_requested, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config.summary, 'password'), false);
  assert.throws(() => buildDatabaseConfig({ DATABASE_URL: 'postgres://example.com/db' }), /mysql/);
}

function testRuntimeState() {
  resetRuntimeState();
  setDatabase({ state: CONTROL_STATES.OPERATIONAL, connected: true, tls_requested: true, tls_active: true });
  setMigrations({ state: CONTROL_STATES.OPERATIONAL, schema_version: '20260911_enterprise_bootstrap_readiness' });
  setControl('smtp', CONTROL_STATES.CONFIGURED, 'secret-free state');
  markReady();
  const safe = publicReadiness();
  assert.equal(safe.ready, true);
  assert.equal(safe.database.tls_active, true);
  assert.equal(JSON.stringify(safe).includes('secret-free state'), false);
  assert.equal(detailedReadiness().controls.smtp.state, CONTROL_STATES.CONFIGURED);
}

function testWiring() {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const bootstrap = server.slice(server.indexOf('async function bootstrap()'));
  const steps = [
    'startupEnvironmentReadiness.warnings.forEach',
    'await verifyDatabaseConnection(pool)',
    'await runMigrations({ pool })',
    'await initializeCriticalSchemas()',
    'await initializeServices()',
    'await initializeWorkers()',
    'return await listenApplication()'
  ];
  let previous = -1;
  for (const step of steps) {
    const index = bootstrap.indexOf(step);
    assert(index > previous, `startup step is missing or out of order: ${step}`);
    previous = index;
  }

  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /app\.get\('\/api\/health',readinessController\.health\)/);
  assert.match(app, /app\.get\('\/api\/ready',readinessController\.ready\)/);
  assert.match(app, /app\.use\('\/api\/security\/readiness',auth,readinessRoutes\)/);
}

function testDatabaseFailurePreventsListen() {
  const root = path.join(__dirname, '..');
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      JWT_SECRET: 'wave-a-fail-closed-test-secret-1234567890',
      DATABASE_URL: '',
      DB_HOST: '127.0.0.1',
      DB_PORT: '65530',
      DB_CONNECT_TIMEOUT_MS: '1000',
      PORT: '5196',
      WEEKLY_TIMESHEET_EMAIL_ENABLED: 'false'
    }
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'database failure should stop the process');
  assert.match(output, /Startup failed during CONNECTING_DATABASE/);
  assert.doesNotMatch(output, /Server ready on/);
}

async function run() {
  testSqlParser();
  testDatabaseConfiguration();
  testRuntimeState();
  testWiring();
  testDatabaseFailurePreventsListen();
  await testMigrationRunner();
  console.log('Enterprise Wave A bootstrap tests passed.');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
