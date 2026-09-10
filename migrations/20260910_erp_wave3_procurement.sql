-- ERP Wave 3: additive procurement lifecycle schema.
-- Runtime startup applies the same idempotent definitions from services/procurementSchema.js.

CREATE TABLE IF NOT EXISTS procurement_sequences (
  sequence_key VARCHAR(30) NOT NULL,
  year_value INT NOT NULL,
  next_value INT NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sequence_key, year_value)
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  requisition_no VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  department VARCHAR(120) NULL,
  required_date DATE NULL,
  business_reason TEXT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  estimated_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  approval_instance_id CHAR(36) NULL,
  requested_by BIGINT NOT NULL,
  cancelled_by BIGINT NULL,
  cancel_reason TEXT NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_purchase_requisition_no (requisition_no),
  INDEX idx_purchase_requisition_status (status, required_date),
  INDEX idx_purchase_requisition_requester (requested_by, created_at)
);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  purchase_requisition_id BIGINT NOT NULL,
  line_no INT NOT NULL,
  item_code VARCHAR(120) NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'each',
  estimated_unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  preferred_supplier_id BIGINT NULL,
  UNIQUE KEY uniq_purchase_requisition_line (purchase_requisition_id, line_no),
  INDEX idx_purchase_requisition_items (purchase_requisition_id)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_rfqs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_rfq_no VARCHAR(40) NOT NULL,
  purchase_requisition_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  issue_date DATE NOT NULL,
  response_due_date DATE NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  closed_by BIGINT NULL,
  closed_at DATETIME NULL,
  close_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_procurement_supplier_rfq_no (supplier_rfq_no),
  INDEX idx_procurement_supplier_rfq_pr (purchase_requisition_id),
  INDEX idx_procurement_supplier_rfq_status (status, response_due_date)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_rfq_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_rfq_id BIGINT NOT NULL,
  requisition_item_id BIGINT NULL,
  line_no INT NOT NULL,
  item_code VARCHAR(120) NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'each',
  UNIQUE KEY uniq_procurement_supplier_rfq_line (supplier_rfq_id, line_no),
  INDEX idx_procurement_supplier_rfq_lines (supplier_rfq_id)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_rfq_invites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_rfq_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'INVITED',
  quote_reference VARCHAR(120) NULL,
  quoted_total DECIMAL(18,2) NULL,
  lead_time_days INT NULL,
  response_notes TEXT NULL,
  responded_at DATETIME NULL,
  selected_at DATETIME NULL,
  selected_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_procurement_supplier_invite (supplier_rfq_id, supplier_id),
  INDEX idx_procurement_supplier_response (supplier_id, status)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(40) NOT NULL,
  purchase_requisition_id BIGINT NOT NULL,
  supplier_rfq_id BIGINT NULL,
  supplier_id BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AUD',
  issue_date DATE NOT NULL,
  expected_date DATE NULL,
  payment_terms VARCHAR(160) NULL,
  delivery_address TEXT NULL,
  notes TEXT NULL,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
  approval_instance_id CHAR(36) NULL,
  created_by BIGINT NOT NULL,
  cancelled_by BIGINT NULL,
  cancel_reason TEXT NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_purchase_order_no (po_number),
  INDEX idx_purchase_order_supplier (supplier_id, status),
  INDEX idx_purchase_order_pr (purchase_requisition_id),
  INDEX idx_purchase_order_expected (status, expected_date)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL,
  requisition_item_id BIGINT NULL,
  line_no INT NOT NULL,
  item_code VARCHAR(120) NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'each',
  unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(7,3) NOT NULL DEFAULT 0,
  line_subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  line_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  received_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  returned_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_purchase_order_line (purchase_order_id, line_no),
  INDEX idx_purchase_order_items (purchase_order_id)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(40) NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  received_date DATE NOT NULL,
  delivery_reference VARCHAR(160) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'RECEIVED',
  notes TEXT NULL,
  received_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_goods_receipt_no (receipt_no),
  INDEX idx_goods_receipt_po (purchase_order_id, received_date),
  INDEX idx_goods_receipt_status (status, received_date)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  goods_receipt_id BIGINT NOT NULL,
  purchase_order_item_id BIGINT NOT NULL,
  quantity_received DECIMAL(14,3) NOT NULL,
  lot_batch_no VARCHAR(120) NULL,
  condition_status VARCHAR(40) NOT NULL DEFAULT 'PENDING_INSPECTION',
  notes TEXT NULL,
  UNIQUE KEY uniq_goods_receipt_item (goods_receipt_id, purchase_order_item_id),
  INDEX idx_goods_receipt_items (goods_receipt_id)
);

CREATE TABLE IF NOT EXISTS receiving_inspections (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inspection_no VARCHAR(40) NOT NULL,
  goods_receipt_id BIGINT NOT NULL,
  result VARCHAR(30) NOT NULL,
  accepted_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  nonconformance_reference VARCHAR(120) NULL,
  notes TEXT NULL,
  inspected_by BIGINT NOT NULL,
  inspected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_receiving_inspection_no (inspection_no),
  UNIQUE KEY uniq_receiving_inspection_receipt (goods_receipt_id)
);

CREATE TABLE IF NOT EXISTS procurement_bill_matches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_no VARCHAR(40) NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  goods_receipt_id BIGINT NOT NULL,
  supplier_bill_id BIGINT NOT NULL,
  purchase_total DECIMAL(18,2) NOT NULL,
  receipt_total DECIMAL(18,2) NOT NULL,
  bill_total DECIMAL(18,2) NOT NULL,
  quantity_variance DECIMAL(14,3) NOT NULL DEFAULT 0,
  amount_variance DECIMAL(18,2) NOT NULL DEFAULT 0,
  tolerance_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL,
  exception_reason TEXT NULL,
  approval_instance_id CHAR(36) NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_procurement_match_no (match_no),
  UNIQUE KEY uniq_procurement_bill_match (supplier_bill_id),
  INDEX idx_procurement_match_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  return_no VARCHAR(40) NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  goods_receipt_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  return_date DATE NOT NULL,
  reason TEXT NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'CREDIT_PENDING',
  created_by BIGINT NOT NULL,
  cancelled_by BIGINT NULL,
  cancel_reason TEXT NULL,
  cancelled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_purchase_return_no (return_no),
  INDEX idx_purchase_return_supplier (supplier_id, status),
  INDEX idx_purchase_return_receipt (goods_receipt_id)
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  purchase_return_id BIGINT NOT NULL,
  purchase_order_item_id BIGINT NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  line_total DECIMAL(18,2) NOT NULL,
  reason VARCHAR(500) NULL,
  UNIQUE KEY uniq_purchase_return_item (purchase_return_id, purchase_order_item_id)
);

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  credit_no VARCHAR(40) NOT NULL,
  purchase_return_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  supplier_credit_reference VARCHAR(120) NOT NULL,
  issue_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_supplier_credit_no (credit_no),
  UNIQUE KEY uniq_supplier_credit_reference (supplier_id, supplier_credit_reference),
  UNIQUE KEY uniq_supplier_credit_return (purchase_return_id)
);
