CREATE TABLE IF NOT EXISTS personal_financial_roadmaps (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  name VARCHAR(180) NOT NULL,
  plan_type VARCHAR(40) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  direction VARCHAR(12) NOT NULL,
  starting_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  target_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  monthly_target DECIMAL(18,4) NULL,
  start_date DATE NOT NULL,
  target_date DATE NOT NULL,
  scenario_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pfr_user_status (user_id, status, target_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_financial_roadmap_milestones (
  id CHAR(36) PRIMARY KEY,
  roadmap_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  milestone_no SMALLINT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  planned_value DECIMAL(18,4) NOT NULL,
  actual_value DECIMAL(18,4) NULL,
  actual_recorded_at DATETIME NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pfrm_roadmap FOREIGN KEY (roadmap_id) REFERENCES personal_financial_roadmaps(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pfrm_roadmap_no (roadmap_id, milestone_no),
  INDEX idx_pfrm_user_due (user_id, due_date),
  INDEX idx_pfrm_roadmap_due (roadmap_id, due_date)
) ENGINE=InnoDB;
