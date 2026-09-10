const assert = require('node:assert');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { buildDatabaseConfig } = require('../config/databaseConfig');
const { LEGACY_SCHEMA_MARKERS, runMigrations } = require('../services/migrationRunner');

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

    const first = await runMigrations({ pool, logger: { info() {} }, env: { DEPLOYMENT_SHA: 'mysql-legacy-test' } });
    assert.equal(first.discovered, 20);
    assert.equal(first.baselined, 19);
    assert.equal(first.applied, 1);
    assert.equal(first.skipped, 0);

    const [[counts]] = await pool.query(`
      SELECT
        SUM(status = 'BASELINED') AS baselined,
        SUM(status = 'APPLIED') AS applied,
        SUM(status = 'FAILED') AS failed
      FROM schema_migrations
    `);
    assert.equal(Number(counts.baselined), 19);
    assert.equal(Number(counts.applied), 1);
    assert.equal(Number(counts.failed), 0);

    const second = await runMigrations({ pool, logger: { info() {} } });
    assert.equal(second.baselined, 0);
    assert.equal(second.applied, 0);
    assert.equal(second.skipped, 20);
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
