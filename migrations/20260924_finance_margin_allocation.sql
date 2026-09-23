CREATE TABLE IF NOT EXISTS finance_margin_entities (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_uid CHAR(36) NOT NULL,
  entity_type VARCHAR(24) NOT NULL,
  entity_code VARCHAR(60) NULL,
  name VARCHAR(180) NOT NULL,
  owner_name VARCHAR(160) NULL,
  target_margin_percent DECIMAL(9,4) NULL,
  notes VARCHAR(800) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_finance_margin_entity_uid (entity_uid),
  INDEX idx_finance_margin_entity_status (status,entity_type,name)
);

CREATE TABLE IF NOT EXISTS finance_margin_allocations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  allocation_uid CHAR(36) NOT NULL,
  entity_id BIGINT NOT NULL,
  bank_transaction_id BIGINT NOT NULL,
  allocation_role VARCHAR(16) NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency CHAR(3) NOT NULL,
  note VARCHAR(600) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  allocated_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_by INT NULL,
  reversed_at DATETIME NULL,
  reversal_reason VARCHAR(600) NULL,
  UNIQUE KEY uniq_finance_margin_allocation_uid (allocation_uid),
  INDEX idx_margin_allocation_tx (bank_transaction_id,status),
  INDEX idx_margin_allocation_entity (entity_id,status,currency,allocation_role)
);

CREATE TABLE IF NOT EXISTS finance_margin_invoice_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  link_uid CHAR(36) NOT NULL,
  entity_id BIGINT NOT NULL,
  invoice_id INT NOT NULL,
  currency CHAR(3) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  note VARCHAR(600) NULL,
  linked_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_by INT NULL,
  reversed_at DATETIME NULL,
  reversal_reason VARCHAR(600) NULL,
  UNIQUE KEY uniq_finance_margin_invoice_link_uid (link_uid),
  INDEX idx_margin_invoice_link_invoice (invoice_id,status),
  INDEX idx_margin_invoice_link_entity (entity_id,status,currency)
);
