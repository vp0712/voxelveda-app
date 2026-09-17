const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');

async function main() {
  const file = path.join(__dirname, '..', 'migrations', '20260917_recovery_drill_evidence_ledger.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (!statements.length) throw new Error('Recovery drill ledger migration is empty.');
  const connection = await pool.getConnection();
  try {
    for (const statement of statements) await connection.query(statement);
    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('recovery_drill_records','recovery_drill_events')"
    );
    const names = new Set(tables.map((row) => row.TABLE_NAME));
    if (!names.has('recovery_drill_records') || !names.has('recovery_drill_events')) {
      throw new Error('Recovery drill ledger migration did not create all required tables.');
    }
    console.log('RECOVERY_DRILL_LEDGER_MIGRATION_OK');
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('RECOVERY_DRILL_LEDGER_MIGRATION_FAILED', error?.message || error);
  process.exit(1);
});
