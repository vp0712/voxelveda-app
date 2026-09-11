const assert = require('node:assert');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { buildDatabaseConfig } = require('../config/databaseConfig');
const { LEGACY_SCHEMA_MARKERS, discoverMigrations, runMigrations } = require('../services/migrationRunner');
const { BackgroundJobStore } = require('../services/backgroundJobStore');
const { BackgroundJobService } = require('../services/backgroundJobService');

async function run() {
  const schema = `voxelveda_wave_a_legacy_${crypto.randomBytes(5).toString('hex')}`;
  const configured = buildDatabaseConfig(process.env).options;
  const { database: _database, ...serverOptions } = configured;
  const admin = mysql.createPool({ ...serverOptions, connectionLimit: 1 });
  let pool;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    pool = mysql.createPool({ ...configured, database: schema, connectionLimit: 2 });
    for (const table of LEGACY_SCHEMA_MARKERS) {
      await pool.query(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY) ENGINE=InnoDB`);
    }

    const expectedMigrations = discoverMigrations().length;
    const first = await runMigrations({ pool, logger: { info() {} }, env: { DEPLOYMENT_SHA: 'mysql-legacy-test' } });
    assert.equal(first.discovered, expectedMigrations);
    assert.equal(first.baselined, 19);
    assert.equal(first.applied, expectedMigrations - first.baselined);
    assert.equal(first.skipped, 0);

    const [[counts]] = await pool.query(`
      SELECT
        SUM(status = 'BASELINED') AS baselined,
        SUM(status = 'APPLIED') AS applied,
        SUM(status = 'FAILED') AS failed
      FROM schema_migrations
    `);
    assert.equal(Number(counts.baselined), 19);
    assert.equal(Number(counts.applied), expectedMigrations - first.baselined);
    assert.equal(Number(counts.failed), 0);

    const [dedupeColumns] = await pool.query('SHOW COLUMNS FROM public_submission_dedupe');
    const dedupeColumnNames = new Set(dedupeColumns.map((column) => column.Field));
    for (const required of ['submission_type', 'dedupe_key', 'payload_sha256', 'lock_token', 'status', 'expires_at']) {
      assert(dedupeColumnNames.has(required), `missing public submission dedupe column: ${required}`);
    }

    for (const table of ['background_job_leases', 'background_job_runs', 'background_job_failures', 'background_job_dead_letters']) {
      const [columns] = await pool.query(`SHOW COLUMNS FROM ${table}`);
      assert(columns.length > 0, `missing background worker table: ${table}`);
    }

    const replicaA = new BackgroundJobService({
      store: new BackgroundJobStore(pool),
      leaseOwner: 'mysql-legacy-replica-a',
      env: { DEPLOYMENT_SHA: 'mysql-legacy-test' }
    });
    const replicaB = new BackgroundJobService({
      store: new BackgroundJobStore(pool),
      leaseOwner: 'mysql-legacy-replica-b',
      env: { DEPLOYMENT_SHA: 'mysql-legacy-test' }
    });
    await replicaA.initialize();
    await replicaB.initialize();
    let releaseHandler;
    let signalStarted;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    const blocked = new Promise((resolve) => { releaseHandler = resolve; });
    let executions = 0;
    const handler = async () => {
      executions += 1;
      signalStarted();
      await blocked;
      return { processed: 1 };
    };
    replicaA.registerJob({ jobKey: 'mysql_singleton_test', handler, leaseMs: 30000 });
    replicaB.registerJob({ jobKey: 'mysql_singleton_test', handler, leaseMs: 30000 });
    const firstWorker = replicaA.runJob('mysql_singleton_test');
    await started;
    const secondWorker = await replicaB.runJob('mysql_singleton_test');
    assert.equal(secondWorker.reason, 'lease_held');
    assert.equal(executions, 1);
    releaseHandler();
    const firstWorkerResult = await firstWorker;
    assert.equal(firstWorkerResult.status, 'COMPLETED');
    const [[workerRuns]] = await pool.query(
      "SELECT COUNT(*) AS total FROM background_job_runs WHERE job_key = 'mysql_singleton_test' AND status = 'COMPLETED'"
    );
    assert.equal(Number(workerRuns.total), 1);

    const second = await runMigrations({ pool, logger: { info() {} } });
    assert.equal(second.baselined, 0);
    assert.equal(second.applied, 0);
    assert.equal(second.skipped, expectedMigrations);
    console.log('Enterprise Wave A legacy MySQL baseline test passed.');
  } finally {
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
