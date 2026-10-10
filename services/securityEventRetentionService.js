'use strict';

const pool = require('../config/db');
const { retainedEventScope } = require('./securityDataScope');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_STEP_UP_REQUIRED_RETENTION_DAYS = 7;
const DEFAULT_ROUTINE_ROW_CAP = 5000;
const DEFAULT_BATCH_SIZE = 2000;
const DEFAULT_MAX_BATCHES = 25;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isSecurityEventCapacityError(error) {
  const code = String(error?.code || '').toUpperCase();
  const errno = Number(error?.errno || 0);
  const message = String(error?.message || '').toLowerCase();
  return code === 'ER_RECORD_FILE_FULL'
    || code === 'ER_DISK_FULL'
    || errno === 1114
    || (message.includes('security_events') && message.includes('is full'))
    || message.includes('table is full');
}

async function deleteBatches(whereSql, params = [], maxRows = Infinity) {
  const scope = retainedEventScope();
  const batchSize = boundedInteger(process.env.SECURITY_EVENT_PRUNE_BATCH_SIZE, DEFAULT_BATCH_SIZE, 100, 10000);
  const maxBatches = boundedInteger(process.env.SECURITY_EVENT_PRUNE_MAX_BATCHES, DEFAULT_MAX_BATCHES, 1, 100);
  let deleted = 0;
  for (let batch = 0; batch < maxBatches && deleted < maxRows; batch += 1) {
    const limit = Math.min(batchSize, Math.max(0, maxRows - deleted));
    if (!limit) break;
    const [result] = await pool.query(
      `DELETE FROM security_events WHERE (${scope.sql}) AND (${whereSql}) ORDER BY id ASC LIMIT ${limit}`,
      [...scope.params, ...params]
    );
    const affected = Number(result?.affectedRows || 0);
    deleted += affected;
    if (affected < limit) break;
  }
  return deleted;
}

async function trimRoutineOverflow() {
  const scope = retainedEventScope();
  const cap = boundedInteger(process.env.SECURITY_EVENT_ROUTINE_ROW_CAP, DEFAULT_ROUTINE_ROW_CAP, 500, 100000);
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM security_events WHERE (${scope.sql}) AND event_type='STEP_UP_REQUIRED'`, scope.params
  );
  const count = Number(row?.count || 0);
  const excess = Math.max(0, count - cap);
  if (!excess) return 0;
  return deleteBatches("event_type='STEP_UP_REQUIRED'", [], excess);
}

async function pruneSecurityEvents({ emergency = false } = {}) {
  const retentionDays = boundedInteger(process.env.SECURITY_EVENT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 7, 730);
  const routineDays = boundedInteger(
    process.env.SECURITY_EVENT_STEP_UP_REQUIRED_RETENTION_DAYS,
    DEFAULT_STEP_UP_REQUIRED_RETENTION_DAYS,
    1,
    90
  );

  let deleted = 0;

  // STEP_UP_REQUIRED is a high-volume preflight/denial telemetry event. Keep a
  // bounded recent window while retaining verified/failed security outcomes.
  deleted += await deleteBatches(
    "event_type='STEP_UP_REQUIRED' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [routineDays]
  );
  deleted += await trimRoutineOverflow();

  // Retained security events are operational telemetry, separate from archived audit
  // ledger. Keep a substantial retention window but do not let this table grow
  // without bound and take authentication offline.
  deleted += await deleteBatches(
    'created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [retentionDays]
  );

  if (emergency) {
    // A full table must not strand authentication. If normal retention did not
    // create enough reusable pages, discard older preflight events first while
    // preserving the newest bounded set plus all verified/failed outcomes.
    deleted += await trimRoutineOverflow();
    deleted += await deleteBatches(
      "event_type='STEP_UP_REQUIRED' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      []
    );
  }

  if (deleted) {
    console.warn(`SECURITY_EVENT_RETENTION_PRUNED rows=${deleted} emergency=${emergency ? 'yes' : 'no'}`);
  }
  return { deleted };
}

module.exports = {
  isSecurityEventCapacityError,
  pruneSecurityEvents,
  _test: { boundedInteger }
};
