CREATE TABLE IF NOT EXISTS vom_report_deliveries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  report_key VARCHAR(80) NOT NULL,
  report_type VARCHAR(40) NOT NULL DEFAULT 'HOURLY',
  recipient VARCHAR(32) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
  message_id VARCHAR(160) NULL,
  status VARCHAR(30) NOT NULL,
  snapshot_json JSON NULL,
  error_code VARCHAR(100) NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME NULL,
  UNIQUE KEY uniq_vom_report_delivery (report_key, report_type, recipient, channel),
  INDEX idx_vom_report_status (status, created_at),
  INDEX idx_vom_report_recipient (recipient, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vom_inbound_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  provider_message_id VARCHAR(160) NOT NULL,
  sender VARCHAR(32) NOT NULL,
  message_type VARCHAR(40) NOT NULL,
  command_text VARCHAR(1000) NULL,
  handled_status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  response_message_id VARCHAR(160) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at DATETIME NULL,
  UNIQUE KEY uniq_vom_inbound_provider_message (provider_message_id),
  INDEX idx_vom_inbound_sender (sender, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
