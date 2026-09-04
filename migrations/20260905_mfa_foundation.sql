ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_mfa_update_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS user_mfa_totp (
  user_id INT PRIMARY KEY,
  secret_ciphertext TEXT NULL,
  pending_secret_ciphertext TEXT NULL,
  key_version VARCHAR(30) NOT NULL DEFAULT 'v1',
  last_used_step BIGINT NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mfa_recovery_code (user_id, code_hash),
  INDEX idx_mfa_recovery_user (user_id, used_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  challenge_type VARCHAR(30) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mfa_challenge_user (user_id, expires_at, used_at)
) ENGINE=InnoDB;
