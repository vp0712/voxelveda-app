CREATE TABLE IF NOT EXISTS security_incidents (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  scope VARCHAR(40) NOT NULL DEFAULT 'ACCOUNT',
  summary VARCHAR(2000) NOT NULL,
  opened_by INT NOT NULL,
  incident_commander_id INT NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contained_at DATETIME NULL,
  resolved_at DATETIME NULL,
  closed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_security_incident_status (status, severity, opened_at),
  INDEX idx_security_incident_commander (incident_commander_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_incident_actions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  incident_id CHAR(36) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  actor_id INT NOT NULL,
  target_user_id INT NULL,
  reason VARCHAR(1000) NOT NULL,
  result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  request_id VARCHAR(80) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_incident_action_incident (incident_id, created_at),
  INDEX idx_incident_action_actor (actor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_report_snapshots (
  id CHAR(36) PRIMARY KEY,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  generated_by INT NOT NULL,
  summary_json JSON NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_security_report_period (period_end, created_at)
) ENGINE=InnoDB;
