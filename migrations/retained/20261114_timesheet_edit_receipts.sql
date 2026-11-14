-- Durable request receipts for explicitly authorised source-timesheet edits.
-- Originals, historical approvals, attendance IDs and prior document versions remain intact.
CREATE TABLE IF NOT EXISTS timesheet_edit_receipts (
  timesheet_id INT NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_json LONGTEXT NOT NULL,
  version_no INT NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (timesheet_id, request_id),
  INDEX idx_timesheet_edit_actor (created_by, created_at)
) ENGINE=InnoDB;
