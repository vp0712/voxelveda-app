CREATE TABLE IF NOT EXISTS personal_finance_restore_uploads (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  transport_sha256 CHAR(64) NOT NULL,
  package_sha256 CHAR(64) NOT NULL,
  total_bytes BIGINT NOT NULL,
  total_chunks INT NOT NULL,
  received_chunks INT NOT NULL DEFAULT 0,
  received_bytes BIGINT NOT NULL DEFAULT 0,
  status ENUM('UPLOADING','VERIFIED','EXPIRED','REJECTED') NOT NULL DEFAULT 'UPLOADING',
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pf_restore_upload_user_status (user_id,status,expires_at),
  INDEX idx_pf_restore_upload_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS personal_finance_restore_upload_chunks (
  upload_id CHAR(36) NOT NULL,
  chunk_index INT NOT NULL,
  chunk_sha256 CHAR(64) NOT NULL,
  chunk_bytes INT NOT NULL,
  chunk_data MEDIUMBLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_id,chunk_index),
  CONSTRAINT fk_pf_restore_chunk_upload FOREIGN KEY (upload_id) REFERENCES personal_finance_restore_uploads(id) ON DELETE CASCADE,
  INDEX idx_pf_restore_chunk_upload (upload_id)
) ENGINE=InnoDB;
