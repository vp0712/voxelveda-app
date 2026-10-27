'use strict';
const path = require('node:path');
const { discoverMigrations, runMigrations, MigrationError } = require('./migrationRunner');
const { preflightOriginalRegisterSchemas, assertOriginalRegisterSchemas } = require('./originalRegisterSchema');

const RETAINED_MIGRATIONS = Object.freeze(['20261025_original_request_schema', '20261027_timesheet_pdf_snapshots']);
const RETAINED_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'retained');

function validateRetainedMigrations(directory = RETAINED_MIGRATIONS_DIR) {
  const migrations = discoverMigrations(directory);
  if (migrations.length !== RETAINED_MIGRATIONS.length || migrations.some((entry, index) => entry.migration_id !== RETAINED_MIGRATIONS[index])) {
    throw new MigrationError('Current original migrations require an explicit ordered registry entry.', 'RETAINED_MIGRATION_NOT_REGISTERED');
  }
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      const executable = statement.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/\b(?:DROP|TRUNCATE|DELETE|REPLACE|RENAME|MODIFY|CHANGE)\b/i.test(executable) || !/^(?:CREATE TABLE IF NOT EXISTS\b|SET @vv_original_schema_sql\s*=|PREPARE vv_original_schema_stmt FROM\b|EXECUTE vv_original_schema_stmt\b|DEALLOCATE PREPARE vv_original_schema_stmt\b)/i.test(executable)) {
        throw new MigrationError('Current original migrations must remain additive.', 'RETAINED_MIGRATION_NOT_ADDITIVE', { migration_id: migration.migration_id });
      }
    }
  }
  return migrations;
}

async function runRetainedMigrations({ pool, logger = console, env = process.env, migrationsDir = RETAINED_MIGRATIONS_DIR } = {}) {
  validateRetainedMigrations(migrationsDir);
  // Inspect existing identity/key and essential-field contracts before even
  // acquiring the migration connection or bootstrapping its ledger. Missing
  // tables and optional fields are expected; incompatible existing data
  // structures require review and must never receive invented identities.
  await preflightOriginalRegisterSchemas(pool);
  // The existing engine supplies the cross-replica advisory lock, ordered
  // checksums, durable APPLIED/FAILED outcomes and safe resumable execution.
  // Its directory contains only reviewed current original migrations; the
  // historical Banking/ERP directory is verified separately and never replayed.
  const result = await runMigrations({ pool, migrationsDir, logger, env });
  await assertOriginalRegisterSchemas(pool);
  return result;
}

module.exports = { RETAINED_MIGRATIONS, RETAINED_MIGRATIONS_DIR, validateRetainedMigrations, runRetainedMigrations };
