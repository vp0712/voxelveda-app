const pool = require('../config/db');

let schemaPromise;

async function tolerateDuplicate(sql) {
  try { await pool.query(sql); } catch (error) {
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR'].includes(error?.code)) throw error;
  }
}

async function createSecuritySchema() {
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN user_uuid CHAR(36) NULL');
  await tolerateDuplicate("ALTER TABLE users ADD COLUMN account_status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'");
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0');
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN locked_until DATETIME NULL');
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 1');
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL');
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN last_password_change_at DATETIME NULL');
  await tolerateDuplicate('ALTER TABLE users ADD COLUMN last_security_review_at DATETIME NULL');
  await tolerateDuplicate('ALTER TABLE users ADD UNIQUE INDEX uq_users_uuid (user_uuid)');
  await pool.query("UPDATE users SET user_uuid = UUID() WHERE user_uuid IS NULL OR user_uuid = ''");
  await pool.query("UPDATE users SET account_status = IF(active = 1, 'ACTIVE', 'DISABLED') WHERE account_status IS NULL OR account_status = ''");

  await pool.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id CHAR(36) PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    assurance_level TINYINT NOT NULL DEFAULT 1,
    session_version INT NOT NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    revoke_reason VARCHAR(100) NULL,
    INDEX idx_auth_sessions_user (user_id, revoked_at, expires_at)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS security_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    target_user_id INT NULL,
    event_type VARCHAR(80) NOT NULL,
    result VARCHAR(20) NOT NULL,
    request_id VARCHAR(80) NULL,
    session_id CHAR(36) NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    metadata_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_security_event_time (event_type, created_at),
    INDEX idx_security_target_time (target_user_id, created_at)
  ) ENGINE=InnoDB`);
}

async function ensureSecuritySchema() {
  if (!schemaPromise) schemaPromise = createSecuritySchema().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

module.exports = { ensureSecuritySchema };
