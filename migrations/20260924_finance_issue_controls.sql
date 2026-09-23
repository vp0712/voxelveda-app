CREATE TABLE IF NOT EXISTS finance_issue_controls (
  finance_issue_id BIGINT PRIMARY KEY,
  due_date DATE NULL,
  assigned_by INT NULL,
  assigned_at DATETIME NULL,
  last_progress_note TEXT NULL,
  last_progress_by INT NULL,
  last_progress_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_finance_issue_control_due (due_date),
  INDEX idx_finance_issue_control_assigned (assigned_by, assigned_at)
);
