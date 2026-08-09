const pool = require('../config/db');

let schemaPromise;

async function addColumn(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

async function addIndex(sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error?.code)) throw error;
  }
}

async function createUserLifecycleSchema() {
  await addColumn('ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL');
  await addColumn('ALTER TABLE users ADD COLUMN deleted_by INT NULL');
  await addColumn('ALTER TABLE users ADD COLUMN deletion_reason VARCHAR(255) NULL');
  await addIndex('ALTER TABLE users ADD INDEX idx_users_active_deleted (active, deleted_at)');
}

async function ensureUserLifecycleSchema() {
  if (!schemaPromise) {
    schemaPromise = createUserLifecycleSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureUserLifecycleSchema };
