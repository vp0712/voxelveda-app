CREATE TABLE IF NOT EXISTS notice_installations (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  secret_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  platform ENUM('web','android','ios') NOT NULL,
  destination_hash CHAR(64) CHARACTER SET ascii NULL UNIQUE,
  destination JSON NULL,
  installed_version VARCHAR(50) NULL,
  release_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  opted_in_at DATETIME(3) NULL,
  owner_id INT NULL,
  owner_session_version INT NULL,
  owner_session_id CHAR(36) NULL,
  retain_after_logout TINYINT(1) NOT NULL DEFAULT 0,
  bound_at DATETIME(3) NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX notice_owner (owner_id, bound_at),
  INDEX notice_release_devices (platform, release_opt_in, last_seen_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notice_releases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  platform ENUM('web','android','ios') NOT NULL,
  release_key VARCHAR(70) CHARACTER SET ascii NOT NULL,
  version VARCHAR(50) NOT NULL,
  action_url VARCHAR(500) NOT NULL,
  verified_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY notice_release_identity (platform, release_key),
  INDEX notice_release_platform (platform, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notice_deliveries (
  installation_id CHAR(36) CHARACTER SET ascii NOT NULL,
  kind ENUM('release','team') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued','sending','accepted','failed','uncertain','skipped') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claim_id CHAR(36) CHARACTER SET ascii NULL,
  claim_at DATETIME(3) NULL,
  provider_code VARCHAR(64) NULL,
  PRIMARY KEY (installation_id, kind, source_id),
  INDEX notice_dispatch (status, next_attempt_at),
  INDEX notice_abandoned (status, claim_at)
) ENGINE=InnoDB;
