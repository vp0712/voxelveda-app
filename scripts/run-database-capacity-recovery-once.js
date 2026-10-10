'use strict';

const pool = require('../config/db');
const {
  databaseFootprint,
  recoverDatabaseCapacity
} = require('../services/databaseCapacityRecoveryService');

function sanitizedDatabaseIdentity() {
  const directHost = String(process.env.DB_HOST || '').trim();
  let urlHost = '';
  try {
    if (process.env.DATABASE_URL) urlHost = new URL(process.env.DATABASE_URL).hostname;
  } catch {}
  return {
    host: directHost || urlHost || null,
    port: String(process.env.DB_PORT || '').trim() || null,
    database: String(process.env.DB_NAME || '').trim() || null
  };
}

async function targetedTableFootprint() {
  const targets = [
    'background_job_runs',
    'security_events',
    'audit_logs',
    'email_logs',
    'email_queue',
    'processing_errors'
  ];
  const placeholders = targets.map(() => '?').join(',');
  const sql =
    'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS rows_estimate, ' +
    'ROUND(COALESCE(DATA_LENGTH,0)/1024/1024,2) AS data_mb, ' +
    'ROUND(COALESCE(INDEX_LENGTH,0)/1024/1024,2) AS index_mb, ' +
    'ROUND((COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0))/1024/1024,2) AS size_mb, ' +
    'ROUND(COALESCE(DATA_FREE,0)/1024/1024,2) AS data_free_mb ' +
    'FROM information_schema.TABLES ' +
    'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (' + placeholders + ') ' +
    'ORDER BY (COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0)) DESC';
  const [rows] = await pool.query(sql, targets);
  return rows.map((row) => ({
    name: row.name,
    engine: row.engine,
    rows_estimate: Number(row.rows_estimate || 0),
    data_mb: Number(row.data_mb || 0),
    index_mb: Number(row.index_mb || 0),
    size_mb: Number(row.size_mb || 0),
    data_free_mb: Number(row.data_free_mb || 0)
  }));
}

async function mysqlIdentity() {
  const [[row]] = await pool.query(
    'SELECT VERSION() AS version, @@version_comment AS version_comment, @@hostname AS mysql_hostname, DATABASE() AS database_name'
  );
  return {
    version: row?.version || null,
    version_comment: row?.version_comment || null,
    mysql_hostname: row?.mysql_hostname || null,
    database_name: row?.database_name || null
  };
}

async function main() {
  console.log('DB_CAPACITY_PREDEPLOY_START');
  console.log('DB_PROVIDER_IDENTITY', JSON.stringify(sanitizedDatabaseIdentity()));
  try {
    console.log('DB_MYSQL_IDENTITY', JSON.stringify(await mysqlIdentity()));
    console.log('DB_TARGET_TABLES', JSON.stringify(await targetedTableFootprint()));
  } catch (error) {
    console.warn('DB_TARGET_DIAGNOSTIC_FAILED', error.code || error.errno || error.message);
  }
  let before = null;
  try {
    before = await databaseFootprint();
    console.log('DB_CAPACITY_PREDEPLOY_BEFORE', JSON.stringify(before));
  } catch (error) {
    console.warn('DB_CAPACITY_PREDEPLOY_BEFORE_FAILED', error.code || error.errno || error.message);
  }

  try {
    const result = await recoverDatabaseCapacity({ force: true });
    console.log('DB_CAPACITY_PREDEPLOY_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('DB_CAPACITY_PREDEPLOY_RECOVERY_INCOMPLETE', JSON.stringify({
      code: error.code || null,
      errno: error.errno || null,
      message: String(error.message || '').slice(0, 300),
      details: error.details || null
    }));
    // Do not turn a capacity-diagnostic/recovery pass into a failed deployment.
    // The old production instance remains available and runtime health will show
    // whether provider-level storage must be increased.
  }

  try {
    const after = await databaseFootprint();
    console.log('DB_CAPACITY_PREDEPLOY_AFTER', JSON.stringify(after));
  } catch (error) {
    console.warn('DB_CAPACITY_PREDEPLOY_AFTER_FAILED', error.code || error.errno || error.message);
  }
}

main()
  .catch((error) => {
    console.error('DB_CAPACITY_PREDEPLOY_UNEXPECTED', error.code || error.message);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
