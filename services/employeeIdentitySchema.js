const pool = require('../config/db');
let schemaPromise;
async function createSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS employee_id_cards (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    card_uuid CHAR(36) NOT NULL,
    verification_token CHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    revoked_at DATETIME NULL,
    revoked_by INT NULL,
    revoke_reason VARCHAR(500) NULL,
    created_by INT NULL,
    updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_employee_card_user (user_id),
    UNIQUE KEY uniq_employee_card_uuid (card_uuid),
    UNIQUE KEY uniq_employee_verify_token (verification_token),
    INDEX idx_employee_card_status (status, expires_at)
  )`);
}
async function ensureEmployeeIdentitySchema(){
  if(!schemaPromise) schemaPromise=createSchema().catch(e=>{schemaPromise=null;throw e});
  return schemaPromise;
}
module.exports={ensureEmployeeIdentitySchema};
