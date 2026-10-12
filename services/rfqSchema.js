'use strict';
const pool = require('../config/db');
let schemaPromise;
async function create() {
  await pool.query(`CREATE TABLE IF NOT EXISTS rfqs (
    id INT AUTO_INCREMENT PRIMARY KEY, customer_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL, phone VARCHAR(80) NULL, material VARCHAR(255) NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1, application TEXT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const column of ['archived TINYINT(1) NOT NULL DEFAULT 0', 'revision INT NOT NULL DEFAULT 0', 'request_key CHAR(64) NULL', 'request_hash CHAR(64) NULL', 'updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP']) {
    await pool.query(`ALTER TABLE rfqs ADD COLUMN ${column}`).catch((err) => { if (err.code !== 'ER_DUP_FIELDNAME') throw err; });
  }
  await pool.query('ALTER TABLE rfqs ADD UNIQUE INDEX uniq_rfq_request_key (request_key)').catch((err) => { if (err.code !== 'ER_DUP_KEYNAME') throw err; });
}
function ensureRfqSchema() {
  if (!schemaPromise) schemaPromise = create().catch((err) => { schemaPromise = null; throw err; });
  return schemaPromise;
}
module.exports = { ensureRfqSchema };
