'use strict';
const pool = require('../config/db');

// Original authorization/HR columns. Inspect compatibility before adding only
// missing columns; never replay historical migrations or rewrite existing IDs.
const COLUMNS = Object.freeze({
  employee_number: 'VARCHAR(40) NULL',
  department: 'VARCHAR(120) NULL',
  manager_id: 'INT NULL',
  access_scope: 'JSON NULL',
  // Explicit staff designation only: existing accounts remain NULL, and are
  // never backfilled from login email or company contacts.
  timesheet_delivery_email: 'VARCHAR(254) NULL'
});
let schemaPromise;
async function ensureHrAdministrationSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const [rows] = await pool.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', ['users']);
    const existing = new Set(rows.map(row => row.COLUMN_NAME));
    for (const [column, definition] of Object.entries(COLUMNS)) {
      if (existing.has(column)) continue;
      try { await pool.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`); }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}
module.exports = { ensureHrAdministrationSchema };
