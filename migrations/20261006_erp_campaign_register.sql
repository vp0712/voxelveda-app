-- Campaign plans only. This register does not send messages or post finance entries.
CREATE TABLE IF NOT EXISTS erp_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  objective VARCHAR(1000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  start_date DATE NULL,
  end_date DATE NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  planned_budget DECIMAL(18,2) NOT NULL DEFAULT 0,
  customer_id BIGINT NULL,
  rfq_id BIGINT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_erp_campaign_status (status, start_date),
  INDEX idx_erp_campaign_rfq (rfq_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
