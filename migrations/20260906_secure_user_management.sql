ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_number VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_compromised_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_security_review_at DATETIME NULL;
UPDATE users SET employee_number = CONCAT('VV-', LPAD(id, 6, '0')) WHERE employee_number IS NULL OR employee_number = '';

CREATE TABLE IF NOT EXISTS user_api_tokens (
  id CHAR(36) PRIMARY KEY, user_id INT NOT NULL, token_name VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE, scopes_json JSON NOT NULL, expires_at DATETIME NULL,
  last_used_at DATETIME NULL, revoked_at DATETIME NULL, revoked_reason VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_api_tokens_user (user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id CHAR(36) PRIMARY KEY, user_id INT NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
  device_label VARCHAR(160) NULL, user_agent VARCHAR(255) NULL, last_used_at DATETIME NULL,
  expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, revoke_reason VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trusted_devices_user (user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_security_actions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NOT NULL, target_user_id INT NOT NULL,
  action_type VARCHAR(60) NOT NULL, previous_state VARCHAR(40) NULL, new_state VARCHAR(40) NULL,
  reason VARCHAR(500) NOT NULL, request_id VARCHAR(80) NULL, ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_security_action_target (target_user_id, created_at),
  INDEX idx_user_security_action_actor (actor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS privileged_access_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, reviewer_id INT NOT NULL,
  role_snapshot VARCHAR(40) NOT NULL, permissions_snapshot JSON NOT NULL,
  decision VARCHAR(20) NOT NULL, reason VARCHAR(500) NOT NULL,
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_access_review_user (user_id, reviewed_at)
) ENGINE=InnoDB;
