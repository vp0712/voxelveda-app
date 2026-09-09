const pool = require('../config/db');

const ELIGIBLE_TABLES = Object.freeze([
  'customers',
  'suppliers',
  'meetings',
  'tasks',
  'announcements',
  'staff_messages',
  'staff_work_requests',
  'notifications'
]);

let schemaPromise;

async function tableExists(db, tableName) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(row?.total || 0) > 0;
}

async function addColumn(db, tableName, definition) {
  await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`).catch((error) => {
    if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
  });
}

async function addIndex(db, tableName, definition) {
  await db.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`).catch((error) => {
    if (!['ER_DUP_KEYNAME', 'ER_DUP_INDEX'].includes(error?.code)) throw error;
  });
}

async function ensureTrashEntitySchema(tableName, db = pool) {
  if (!ELIGIBLE_TABLES.includes(tableName)) throw new Error('Trash entity table is not allowlisted');
  if (!await tableExists(db, tableName)) return false;

  await addColumn(db, tableName, 'deleted_at DATETIME NULL');
  await addColumn(db, tableName, 'deleted_by BIGINT NULL');
  await addColumn(db, tableName, 'delete_reason TEXT NULL');
  await addColumn(db, tableName, 'purge_after DATETIME NULL');
  await addIndex(db, tableName, `INDEX idx_${tableName}_trash (deleted_at, purge_after)`);
  return true;
}

async function createTrashSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trash_items (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      trash_uuid CHAR(36) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(120) NOT NULL,
      entity_display_name VARCHAR(255) NOT NULL,
      source_module VARCHAR(100) NOT NULL,
      original_parent_type VARCHAR(80) NULL,
      original_parent_id VARCHAR(120) NULL,
      deleted_by BIGINT NULL,
      deleted_at DATETIME NOT NULL,
      delete_reason TEXT NULL,
      purge_at DATETIME NOT NULL,
      restore_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
      restored_by BIGINT NULL,
      restored_at DATETIME NULL,
      purged_at DATETIME NULL,
      metadata_json LONGTEXT NULL,
      integrity_hash CHAR(64) NOT NULL,
      retention_hold TINYINT(1) NOT NULL DEFAULT 0,
      purge_attempts INT NOT NULL DEFAULT 0,
      purge_error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_trash_uuid (trash_uuid),
      INDEX idx_trash_active_purge (restore_status, purge_at),
      INDEX idx_trash_entity (entity_type, entity_id, restore_status),
      INDEX idx_trash_actor (deleted_by, deleted_at),
      INDEX idx_trash_module (source_module, deleted_at)
    )
  `);

  for (const tableName of ELIGIBLE_TABLES) await ensureTrashEntitySchema(tableName);
}

async function ensureTrashSchema() {
  if (!schemaPromise) {
    schemaPromise = createTrashSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ELIGIBLE_TABLES, ensureTrashEntitySchema, ensureTrashSchema };
