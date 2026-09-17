const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');

async function main() {
  const file = path.join(__dirname, '..', 'migrations', '20260917_recovery_remediation_workflow.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
  if (!statements.length) throw new Error('Recovery remediation migration is empty.');

  const connection = await pool.getConnection();
  try {
    for (const statement of statements) await connection.query(statement);
    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('recovery_remediation_items','recovery_remediation_events')"
    );
    const names = new Set(tables.map((row) => row.TABLE_NAME));
    if (!names.has('recovery_remediation_items') || !names.has('recovery_remediation_events')) {
      throw new Error('Recovery remediation migration did not create all required tables.');
    }
    console.log('RECOVERY_REMEDIATION_MIGRATION_OK');
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('RECOVERY_REMEDIATION_MIGRATION_FAILED', error?.message || error);
  process.exit(1);
});
