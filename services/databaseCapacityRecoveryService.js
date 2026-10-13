'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');

// Only the current email worker and reversible capacity probe are retained.
// Unknown and retired module job history remains archived in place.
const RETAINED_CAPACITY_JOB_KEYS = Object.freeze(['email_queue_delivery', 'capacity.probe']);
const RETAINED_EMAIL_MODULES = Object.freeze(['auth', 'security', 'contact']);

const CAPACITY_CODES = new Set(['ER_RECORD_FILE_FULL', 'ER_DISK_FULL']);

function isCapacityError(error) {
  const code = String(error?.code || '').toUpperCase();
  const errno = Number(error?.errno || 0);
  const message = String(error?.message || '').toLowerCase();
  return CAPACITY_CODES.has(code)
    || errno === 1114
    || message.includes('table is full')
    || message.includes('no space left on device');
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function tableExists(table) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',
    [table]
  );
  return Number(row?.count || 0) > 0;
}

async function databaseFootprint() {
  const [[summary]] = await pool.query(
    `SELECT
       ROUND(COALESCE(SUM(data_length + index_length),0)/1024/1024,2) AS size_mb,
       ROUND(COALESCE(SUM(data_free),0)/1024/1024,2) AS data_free_mb
     FROM information_schema.tables
     WHERE table_schema=DATABASE()`
  );
  const [largest] = await pool.query(
    `SELECT table_name,
            ROUND((COALESCE(data_length,0)+COALESCE(index_length,0))/1024/1024,2) AS size_mb,
            table_rows
       FROM information_schema.tables
      WHERE table_schema=DATABASE()
      ORDER BY (COALESCE(data_length,0)+COALESCE(index_length,0)) DESC
      LIMIT 12`
  );
  return {
    size_mb: Number(summary?.size_mb || 0),
    data_free_mb: Number(summary?.data_free_mb || 0),
    largest: largest.map((row) => ({
      table: row.table_name,
      size_mb: Number(row.size_mb || 0),
      rows: Number(row.table_rows || 0)
    }))
  };
}

async function capacityProbe() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (await tableExists('security_events')) {
      await connection.query(
        "INSERT INTO security_events (event_type,result,metadata_json) VALUES ('DB_CAPACITY_PROBE','SUCCESS',JSON_OBJECT('temporary',true))"
      );
    }
    if (await tableExists('background_job_runs')) {
      await connection.query(
        `INSERT INTO background_job_runs
         (run_uuid,job_key,lease_token,started_at,completed_at,status,attempt,trigger_source)
         VALUES (?, 'capacity.probe', ?, NOW(3), NOW(3), 'COMPLETED', 1, 'STARTUP')`,
        [crypto.randomUUID(), crypto.randomUUID()]
      );
    }
    await connection.rollback();
    return { writable: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    return { writable: false, error };
  } finally {
    connection.release();
  }
}

async function recoverDatabaseCapacity(options = {}) {
  const enabled = String(process.env.DB_CAPACITY_RECOVERY_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true';
  if (!enabled && !options.force) return { skipped: true, reason: 'disabled' };

  const before = await databaseFootprint().catch(() => ({ size_mb: null, data_free_mb: null, largest: [] }));
  const deleted = {};
  const probe = await capacityProbe();
  // Preservation hold: capacity checks never erase historical business, audit,
  // email or worker records. The probe is rolled back before returning.

  const after = await databaseFootprint().catch(() => ({ size_mb: null, data_free_mb: null, largest: [] }));
  const summary = {
    before_size_mb: before.size_mb,
    after_size_mb: after.size_mb,
    data_free_mb: after.data_free_mb,
    deleted,
    emergency_actions: [],
    writable: Boolean(probe.writable),
    top_tables: after.largest.slice(0, 8)
  };
  console.log('DB_CAPACITY_RECOVERY', JSON.stringify(summary));

  if (!probe.writable) {
    const error = new Error('Database cannot allocate new rows; historical records were preserved and provider capacity must be reviewed.');
    error.code = isCapacityError(probe.error) ? 'DATABASE_CAPACITY_EXHAUSTED' : (probe.error?.code || 'DATABASE_WRITE_PROBE_FAILED');
    error.details = summary;
    throw error;
  }
  return summary;
}

module.exports = {
  databaseFootprint,
  isCapacityError,
  recoverDatabaseCapacity,
  _test: { boundedInteger, RETAINED_CAPACITY_JOB_KEYS, RETAINED_EMAIL_MODULES }
};
