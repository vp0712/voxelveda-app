CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  token_type VARCHAR(30) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_action_user (user_id, token_type, expires_at)
) ENGINE=InnoDB;
