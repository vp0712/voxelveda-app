const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { deploymentSha } = require('./runtimeState');

const MIGRATION_FILE = /^\d{8}_[a-z0-9_]+\.sql$/i;
const MIGRATION_LOCK = 'voxelveda:schema-migrations:v1';
const LEGACY_BASELINE_BOUNDARY = '20260911_enterprise_bootstrap_readiness';
const LEGACY_SCHEMA_MARKERS = Object.freeze(['users', 'customers', 'suppliers', 'invoices', 'rfqs', 'expenses']);

class MigrationError extends Error {
  constructor(message, code = 'MIGRATION_FAILED', details = null) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details;
  }
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isExecutable(statement) {
  return statement
    .replace(/^\s*--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim().length > 0;
}

function splitMigrationSql(content) {
  const statements = [];
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let delimiter = ';';
  let buffer = [];
  for (const line of lines) {
    const directive = line.trim().match(/^DELIMITER\s+(\S+)$/i);
    if (directive) {
      if (buffer.some((entry) => entry.trim())) {
        throw new MigrationError('DELIMITER changed before the previous SQL statement ended', 'MIGRATION_PARSE_FAILED');
      }
      delimiter = directive[1];
      buffer = [];
      continue;
    }
    buffer.push(line);
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const joined = buffer.join('\n');
    const end = joined.lastIndexOf(delimiter);
    const statement = joined.slice(0, end).trim();
    if (isExecutable(statement)) statements.push(statement);
    buffer = [];
  }
  const remainder = buffer.join('\n').trim();
  if (isExecutable(remainder)) {
    throw new MigrationError('Migration ends with an incomplete SQL statement', 'MIGRATION_PARSE_FAILED');
  }
  return statements;
}

function discoverMigrations(migrationsDir = path.join(__dirname, '..', 'migrations')) {
  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .map((entry) => {
      const filename = path.join(migrationsDir, entry.name);
      const content = fs.readFileSync(filename, 'utf8');
      return {
        migration_id: entry.name.replace(/\.sql$/i, ''),
        filename,
        checksum_sha256: checksum(content),
        statements: splitMigrationSql(content)
      };
    })
    .sort((left, right) => left.migration_id.localeCompare(right.migration_id));
}

async function ensureMigrationLedger(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(190) PRIMARY KEY,
      checksum_sha256 CHAR(64) NOT NULL,
      applied_at DATETIME NULL,
      deployment_sha VARCHAR(80) NULL,
      duration_ms BIGINT NULL,
      status VARCHAR(20) NOT NULL,
      error_code VARCHAR(80) NULL,
      error_message VARCHAR(500) NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_schema_migrations_status (status, migration_id)
    ) ENGINE=InnoDB
  `);
}

async function baselineLegacySchema(connection, migrations, env, logger) {
  const [[ledgerState]] = await connection.query(`
    SELECT
      SUM(status IN ('APPLIED', 'BASELINED')) AS immutable_count,
      COUNT(*) AS total_count
    FROM schema_migrations
  `);
  if (Number(ledgerState?.immutable_count || 0) > 0) return 0;

  const placeholders = LEGACY_SCHEMA_MARKERS.map(() => '?').join(', ');
  const [[schemaState]] = await connection.query(
    `SELECT COUNT(*) AS marker_count
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
    LEGACY_SCHEMA_MARKERS
  );
  if (Number(schemaState?.marker_count || 0) !== LEGACY_SCHEMA_MARKERS.length) return 0;

  const historical = migrations.filter((migration) => migration.migration_id < LEGACY_BASELINE_BOUNDARY);
  for (const migration of historical) {
    await connection.query(
      `INSERT INTO schema_migrations
       (migration_id, checksum_sha256, deployment_sha, status, started_at, applied_at, duration_ms, error_code, error_message)
       VALUES (?, ?, ?, 'BASELINED', NOW(), NOW(), 0, 'LEGACY_SCHEMA_ADOPTION', NULL)
       ON DUPLICATE KEY UPDATE checksum_sha256 = VALUES(checksum_sha256), deployment_sha = VALUES(deployment_sha),
       status = 'BASELINED', applied_at = NOW(), duration_ms = 0,
       error_code = 'LEGACY_SCHEMA_ADOPTION', error_message = NULL`,
      [migration.migration_id, migration.checksum_sha256, deploymentSha(env)]
    );
  }
  if (historical.length) logger.info?.(`Legacy schema baseline recorded for ${historical.length} migration(s).`);
  return historical.length;
}

function safeMigrationMessage(error) {
  return String(error?.message || 'Migration failed')
    .replace(/(password|secret|token)\s*[=:]\s*[^\s;]+/gi, '$1=[redacted]')
    .slice(0, 500);
}

async function runMigrations({ pool, migrationsDir, lockTimeoutSeconds, logger = console, env = process.env } = {}) {
  if (!pool?.getConnection) throw new MigrationError('A database pool is required', 'MIGRATION_POOL_REQUIRED');
  const migrations = discoverMigrations(migrationsDir);
  const requestedTimeout = Number(lockTimeoutSeconds || env.MIGRATION_LOCK_TIMEOUT_SECONDS || 60);
  const timeout = Number.isFinite(requestedTimeout) ? Math.min(300, Math.max(1, Math.floor(requestedTimeout))) : 60;
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let current = null;
  let applied = 0;
  let baselined = 0;
  let skipped = 0;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [MIGRATION_LOCK, timeout]);
    if (Number(lock?.acquired) !== 1) {
      throw new MigrationError('Migration lock could not be acquired', 'MIGRATION_LOCK_UNAVAILABLE');
    }
    lockAcquired = true;
    await ensureMigrationLedger(connection);
    baselined = await baselineLegacySchema(connection, migrations, env, logger);
    const newlyBaselined = new Set(baselined
      ? migrations.filter((migration) => migration.migration_id < LEGACY_BASELINE_BOUNDARY).map((migration) => migration.migration_id)
      : []);

    for (const migration of migrations) {
      current = migration;
      const [[existing]] = await connection.query(
        'SELECT migration_id, checksum_sha256, status FROM schema_migrations WHERE migration_id = ? LIMIT 1',
        [migration.migration_id]
      );
      if (existing?.checksum_sha256 && existing.checksum_sha256 !== migration.checksum_sha256) {
        throw new MigrationError(
          `Checksum mismatch for migration ${migration.migration_id}`,
          'MIGRATION_CHECKSUM_MISMATCH',
          { migration_id: migration.migration_id }
        );
      }
      if (['APPLIED', 'BASELINED'].includes(existing?.status)) {
        if (!newlyBaselined.has(migration.migration_id)) skipped += 1;
        continue;
      }

      await connection.query(
        `INSERT INTO schema_migrations
         (migration_id, checksum_sha256, deployment_sha, status, started_at, applied_at, duration_ms, error_code, error_message)
         VALUES (?, ?, ?, 'RUNNING', NOW(), NULL, NULL, NULL, NULL)
         ON DUPLICATE KEY UPDATE checksum_sha256 = VALUES(checksum_sha256), deployment_sha = VALUES(deployment_sha),
         status = 'RUNNING', started_at = NOW(), applied_at = NULL, duration_ms = NULL, error_code = NULL, error_message = NULL`,
        [migration.migration_id, migration.checksum_sha256, deploymentSha(env)]
      );
      const startedAt = Date.now();
      try {
        for (const statement of migration.statements) await connection.query(statement);
        const duration = Date.now() - startedAt;
        await connection.query(
          `UPDATE schema_migrations SET status = 'APPLIED', applied_at = NOW(), duration_ms = ?,
           deployment_sha = ?, error_code = NULL, error_message = NULL WHERE migration_id = ?`,
          [duration, deploymentSha(env), migration.migration_id]
        );
        applied += 1;
        logger.info?.(`Migration applied: ${migration.migration_id} (${duration}ms)`);
      } catch (error) {
        await connection.query(
          `UPDATE schema_migrations SET status = 'FAILED', duration_ms = ?, error_code = ?, error_message = ?
           WHERE migration_id = ?`,
          [Date.now() - startedAt, String(error?.code || 'MIGRATION_STATEMENT_FAILED').slice(0, 80), safeMigrationMessage(error), migration.migration_id]
        ).catch(() => {});
        throw new MigrationError(
          `Migration ${migration.migration_id} failed`,
          'MIGRATION_EXECUTION_FAILED',
          { migration_id: migration.migration_id, cause_code: error?.code || null }
        );
      }
    }

    const [[latest]] = await connection.query(
      "SELECT migration_id FROM schema_migrations WHERE status IN ('APPLIED', 'BASELINED') ORDER BY migration_id DESC LIMIT 1"
    );
    return {
      schema_version: latest?.migration_id || null,
      discovered: migrations.length,
      applied,
      baselined,
      skipped
    };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('Migration runner failed', 'MIGRATION_RUNNER_FAILED', {
      migration_id: current?.migration_id || null,
      cause_code: error?.code || null
    });
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK]).catch(() => {});
    connection.release();
  }
}

module.exports = {
  MIGRATION_LOCK,
  LEGACY_BASELINE_BOUNDARY,
  LEGACY_SCHEMA_MARKERS,
  MigrationError,
  baselineLegacySchema,
  checksum,
  discoverMigrations,
  ensureMigrationLedger,
  runMigrations,
  splitMigrationSql
};
