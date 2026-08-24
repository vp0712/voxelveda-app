const pool = require('../config/db');
const { financialYearForDate } = require('./financeDomain');

let schemaPromise;

async function createTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS finance_settings (
      id TINYINT PRIMARY KEY,
      default_currency CHAR(3) NOT NULL DEFAULT 'AUD',
      financial_year_start_month TINYINT NOT NULL DEFAULT 7,
      financial_year_start_day TINYINT NOT NULL DEFAULT 1,
      gst_registered TINYINT(1) NULL,
      default_gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10.00,
      amounts_include_gst TINYINT(1) NOT NULL DEFAULT 0,
      receipt_required_above DECIMAL(14,2) NULL,
      approval_manager_limit DECIMAL(14,2) NOT NULL DEFAULT 500.00,
      approval_finance_limit DECIMAL(14,2) NOT NULL DEFAULT 5000.00,
      accountant_email VARCHAR(255) NULL,
      entity_type VARCHAR(80) NULL,
      setup_status VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE',
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS financial_years (
      id INT AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      readiness_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      blocking_issue_count INT NOT NULL DEFAULT 0,
      warning_issue_count INT NOT NULL DEFAULT 0,
      locked_at DATETIME NULL,
      locked_by INT NULL,
      lock_reason TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_financial_year_label (label),
      UNIQUE KEY uniq_financial_year_dates (start_date, end_date),
      INDEX idx_financial_year_status (status, start_date)
    )`,
    `CREATE TABLE IF NOT EXISTS accounting_periods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      financial_year_id INT NOT NULL,
      period_key VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      locked_at DATETIME NULL,
      locked_by INT NULL,
      lock_reason TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_accounting_period (financial_year_id, period_key),
      INDEX idx_accounting_period_dates (start_date, end_date, status)
    )`,
    `CREATE TABLE IF NOT EXISTS tax_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL,
      name VARCHAR(120) NOT NULL,
      rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      applies_to VARCHAR(30) NOT NULL DEFAULT 'BOTH',
      gst_reportable TINYINT(1) NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      description TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_tax_code (code)
    )`,
    `CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_code VARCHAR(30) NOT NULL,
      account_name VARCHAR(180) NOT NULL,
      account_type VARCHAR(40) NOT NULL,
      reporting_category VARCHAR(80) NULL,
      parent_account_id INT NULL,
      default_tax_code_id INT NULL,
      description TEXT NULL,
      mapping_status VARCHAR(30) NOT NULL DEFAULT 'REVIEW_REQUIRED',
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_account_code (account_code),
      INDEX idx_chart_account_type (account_type, active)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      transaction_uid VARCHAR(60) NOT NULL,
      reference VARCHAR(120) NULL,
      effective_date DATE NOT NULL,
      transaction_type VARCHAR(40) NOT NULL,
      description TEXT NOT NULL,
      party_name VARCHAR(255) NULL,
      customer_id INT NULL,
      supplier_id INT NULL,
      job_reference VARCHAR(120) NULL,
      debit_account_id INT NULL,
      credit_account_id INT NULL,
      category VARCHAR(120) NULL,
      subcategory VARCHAR(120) NULL,
      net_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      gross_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      tax_code_id INT NULL,
      tax_override TINYINT(1) NOT NULL DEFAULT 0,
      tax_override_reason TEXT NULL,
      payment_method VARCHAR(80) NULL,
      bank_account_id INT NULL,
      source_module VARCHAR(80) NULL,
      source_record_id VARCHAR(80) NULL,
      invoice_bill_reference VARCHAR(120) NULL,
      notes TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
      reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'UNRECONCILED',
      financial_year_id INT NOT NULL,
      bas_quarter VARCHAR(10) NULL,
      posted_at DATETIME NULL,
      posted_by INT NULL,
      voided_at DATETIME NULL,
      voided_by INT NULL,
      void_reason TEXT NULL,
      reversal_transaction_id BIGINT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_finance_transaction_uid (transaction_uid),
      UNIQUE KEY uniq_finance_source (source_module, source_record_id),
      INDEX idx_finance_txn_fy_status (financial_year_id, status, effective_date),
      INDEX idx_finance_txn_party (supplier_id, customer_id),
      INDEX idx_finance_txn_reference (reference, invoice_bill_reference)
    )`,
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      journal_uid VARCHAR(60) NOT NULL,
      entry_date DATE NOT NULL,
      reference VARCHAR(120) NULL,
      description TEXT NOT NULL,
      financial_year_id INT NOT NULL,
      source_transaction_id BIGINT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
      total_debit DECIMAL(18,2) NOT NULL DEFAULT 0,
      total_credit DECIMAL(18,2) NOT NULL DEFAULT 0,
      reversal_of_id BIGINT NULL,
      posted_at DATETIME NULL,
      posted_by INT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_journal_uid (journal_uid),
      UNIQUE KEY uniq_journal_source_txn (source_transaction_id),
      INDEX idx_journal_fy_status (financial_year_id, status, entry_date)
    )`,
    `CREATE TABLE IF NOT EXISTS journal_lines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      journal_entry_id BIGINT NOT NULL,
      line_no INT NOT NULL,
      account_id INT NOT NULL,
      description VARCHAR(255) NULL,
      debit DECIMAL(18,2) NOT NULL DEFAULT 0,
      credit DECIMAL(18,2) NOT NULL DEFAULT 0,
      customer_id INT NULL,
      supplier_id INT NULL,
      job_reference VARCHAR(120) NULL,
      tax_code_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_journal_line (journal_entry_id, line_no),
      INDEX idx_journal_line_account (account_id, journal_entry_id)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_issues (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      fingerprint VARCHAR(180) NOT NULL,
      financial_year_id INT NULL,
      severity VARCHAR(30) NOT NULL,
      issue_type VARCHAR(80) NOT NULL,
      module VARCHAR(80) NOT NULL,
      record_type VARCHAR(80) NULL,
      record_id VARCHAR(80) NULL,
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      assigned_to INT NULL,
      resolution_note TEXT NULL,
      ignored_reason TEXT NULL,
      resolved_by INT NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_finance_issue_fingerprint (fingerprint),
      INDEX idx_finance_issue_queue (financial_year_id, status, severity),
      INDEX idx_finance_issue_record (module, record_type, record_id)
    )`,
    `CREATE TABLE IF NOT EXISTS supplier_bills (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      bill_uid VARCHAR(60) NOT NULL,
      supplier_id INT NOT NULL,
      supplier_invoice_no VARCHAR(120) NOT NULL,
      issue_date DATE NOT NULL,
      due_date DATE NULL,
      job_reference VARCHAR(120) NULL,
      tax_code_id INT NULL,
      net_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
      approval_note TEXT NULL,
      approved_by INT NULL,
      approved_at DATETIME NULL,
      voided_by INT NULL,
      voided_at DATETIME NULL,
      void_reason TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_supplier_bill_uid (bill_uid),
      UNIQUE KEY uniq_supplier_invoice (supplier_id, supplier_invoice_no),
      INDEX idx_supplier_bill_status_due (status, due_date)
    )`,
    `CREATE TABLE IF NOT EXISTS supplier_bill_items (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      supplier_bill_id BIGINT NOT NULL,
      line_no INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      quantity DECIMAL(14,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
      net_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      account_id INT NULL,
      tax_code_id INT NULL,
      UNIQUE KEY uniq_supplier_bill_line (supplier_bill_id, line_no)
    )`,
    `CREATE TABLE IF NOT EXISTS supplier_bill_payments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      payment_uid VARCHAR(60) NOT NULL,
      supplier_bill_id BIGINT NOT NULL,
      payment_date DATE NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      bank_account_id INT NULL,
      reference VARCHAR(180) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_by INT NULL,
      voided_at DATETIME NULL,
      void_reason TEXT NULL,
      UNIQUE KEY uniq_supplier_payment_uid (payment_uid),
      INDEX idx_supplier_payment_bill (supplier_bill_id, payment_date)
    )`,
    `CREATE TABLE IF NOT EXISTS bank_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nickname VARCHAR(120) NOT NULL,
      institution VARCHAR(180) NULL,
      bsb_masked VARCHAR(30) NULL,
      account_number_masked VARCHAR(40) NULL,
      currency CHAR(3) NOT NULL DEFAULT 'AUD',
      opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
      current_ledger_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
      reconciled_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bank_import_batches (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      batch_uid VARCHAR(60) NOT NULL,
      bank_account_id INT NOT NULL,
      original_name VARCHAR(255) NULL,
      imported_rows INT NOT NULL DEFAULT 0,
      duplicate_rows INT NOT NULL DEFAULT 0,
      rejected_rows INT NOT NULL DEFAULT 0,
      imported_by INT NULL,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bank_import_batch_uid (batch_uid),
      INDEX idx_bank_import_account (bank_account_id, imported_at)
    )`,
    `CREATE TABLE IF NOT EXISTS bank_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      bank_account_id INT NOT NULL,
      import_batch_uid VARCHAR(60) NOT NULL,
      row_hash CHAR(64) NOT NULL,
      transaction_date DATE NOT NULL,
      description VARCHAR(500) NULL,
      reference VARCHAR(180) NULL,
      debit DECIMAL(18,2) NOT NULL DEFAULT 0,
      credit DECIMAL(18,2) NOT NULL DEFAULT 0,
      running_balance DECIMAL(18,2) NULL,
      reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'UNRECONCILED',
      ignored_reason TEXT NULL,
      imported_by INT NULL,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bank_row (bank_account_id, row_hash),
      INDEX idx_bank_txn_reconcile (bank_account_id, reconciliation_status, transaction_date)
    )`,
    `CREATE TABLE IF NOT EXISTS reconciliation_matches (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      bank_transaction_id BIGINT NOT NULL,
      finance_transaction_id BIGINT NOT NULL,
      matched_amount DECIMAL(18,2) NOT NULL,
      match_type VARCHAR(30) NOT NULL DEFAULT 'MATCH',
      match_note TEXT NULL,
      matched_by INT NULL,
      matched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_reconciliation_pair (bank_transaction_id, finance_transaction_id)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      module VARCHAR(80) NOT NULL,
      record_id VARCHAR(80) NOT NULL,
      document_type VARCHAR(50) NOT NULL DEFAULT 'OTHER',
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      storage_path VARCHAR(500) NULL,
      content_hash CHAR(64) NOT NULL,
      file_size BIGINT NOT NULL DEFAULT 0,
      uploaded_by INT NULL,
      uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      deleted_by INT NULL,
      INDEX idx_finance_document_record (module, record_id, deleted_at),
      INDEX idx_finance_document_hash (content_hash)
    )`,
    `CREATE TABLE IF NOT EXISTS accountant_queries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      query_uid VARCHAR(60) NOT NULL,
      financial_year_id INT NULL,
      module VARCHAR(80) NOT NULL,
      record_id VARCHAR(80) NULL,
      question TEXT NOT NULL,
      answer TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'QUESTION',
      raised_by INT NULL,
      assigned_to INT NULL,
      answered_by INT NULL,
      raised_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      answered_at DATETIME NULL,
      resolved_at DATETIME NULL,
      UNIQUE KEY uniq_accountant_query_uid (query_uid),
      INDEX idx_accountant_query_status (financial_year_id, status)
    )`,
    `CREATE TABLE IF NOT EXISTS accountant_exports (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      export_uid VARCHAR(60) NOT NULL,
      financial_year_id INT NOT NULL,
      version_no INT NOT NULL,
      export_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
      manifest_json LONGTEXT NOT NULL,
      checksum_sha256 CHAR(64) NULL,
      generated_by INT NULL,
      generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      emailed_to VARCHAR(255) NULL,
      emailed_at DATETIME NULL,
      UNIQUE KEY uniq_accountant_export_uid (export_uid),
      UNIQUE KEY uniq_accountant_export_version (financial_year_id, version_no)
    )`,
    `CREATE TABLE IF NOT EXISTS assets (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_number VARCHAR(60) NOT NULL,
      description VARCHAR(255) NOT NULL,
      category VARCHAR(120) NULL,
      purchase_date DATE NULL,
      supplier_id INT NULL,
      purchase_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
      net_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
      serial_number VARCHAR(180) NULL,
      location VARCHAR(180) NULL,
      assigned_to INT NULL,
      accounting_status VARCHAR(30) NOT NULL DEFAULT 'REVIEW_REQUIRED',
      useful_life_months INT NULL,
      depreciation_method VARCHAR(80) NULL,
      opening_written_down_value DECIMAL(18,2) NULL,
      closing_written_down_value DECIMAL(18,2) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_asset_number (asset_number)
    )`
  ];

  for (const sql of statements) await pool.query(sql);
}

async function seedReferenceData() {
  await pool.query(`INSERT IGNORE INTO finance_settings (id) VALUES (1)`);
  const taxCodes = [
    ['GST_ON_INCOME', 'GST on Income', '10.00', 'INCOME', 1, 'Australian taxable sales; confirm business GST registration in Finance Setup.'],
    ['GST_ON_EXPENSES', 'GST on Expenses', '10.00', 'EXPENSE', 1, 'Australian creditable acquisitions; accountant review may still be required.'],
    ['GST_FREE', 'GST Free', '0.00', 'BOTH', 1, 'GST-free treatment.'],
    ['INPUT_TAXED', 'Input Taxed', '0.00', 'BOTH', 1, 'Input-taxed treatment.'],
    ['NO_GST', 'No GST', '0.00', 'BOTH', 0, 'No GST is recorded.'],
    ['OUT_OF_SCOPE', 'Out of Scope', '0.00', 'BOTH', 0, 'Outside GST reporting scope.']
  ];
  for (const row of taxCodes) {
    await pool.query(
      `INSERT IGNORE INTO tax_codes (code, name, rate, applies_to, gst_reportable, description) VALUES (?, ?, ?, ?, ?, ?)`,
      row
    );
  }

  const accounts = [
    ['1000', 'Business Bank', 'ASSET', 'Cash and Cash Equivalents'],
    ['1100', 'Accounts Receivable', 'ASSET', 'Trade Receivables'],
    ['1200', 'Inventory', 'ASSET', 'Inventory'],
    ['1500', 'Plant and Equipment', 'ASSET', 'Non-current Assets'],
    ['2000', 'Accounts Payable', 'LIABILITY', 'Trade Payables'],
    ['2100', 'GST Clearing', 'LIABILITY', 'GST'],
    ['3000', 'Owner Equity', 'EQUITY', 'Equity'],
    ['4000', 'Sales Revenue', 'REVENUE', 'Operating Revenue'],
    ['5000', 'Cost of Sales', 'COST_OF_SALES', 'Cost of Sales'],
    ['6000', 'Operating Expenses', 'EXPENSE', 'Operating Expenses'],
    ['6999', 'Suspense - Review Required', 'ASSET', 'Review Required']
  ];
  for (const row of accounts) {
    await pool.query(
      `INSERT IGNORE INTO chart_of_accounts (account_code, account_name, account_type, reporting_category, mapping_status)
       VALUES (?, ?, ?, ?, 'REVIEW_REQUIRED')`,
      row
    );
  }
}

async function ensureFinancialYears() {
  const [[settings]] = await pool.query(`SELECT financial_year_start_month, financial_year_start_day FROM finance_settings WHERE id = 1`);
  const month = Number(settings?.financial_year_start_month || 7);
  const day = Number(settings?.financial_year_start_day || 1);
  const current = financialYearForDate(new Date().toISOString().slice(0, 10), month, day);
  for (let offset = -2; offset <= 2; offset += 1) {
    const startYear = current.startYear + offset;
    const start = `${startYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const nextStart = new Date(`${startYear + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    const end = nextStart.toISOString().slice(0, 10);
    const label = `FY${startYear}-${String(startYear + 1).slice(-2)}`;
    await pool.query(
      `INSERT IGNORE INTO financial_years (label, start_date, end_date) VALUES (?, ?, ?)`,
      [label, start, end]
    );
    const [[year]] = await pool.query(`SELECT id FROM financial_years WHERE label = ?`, [label]);
    for (let index = 0; index < 12; index += 1) {
      const periodStart = new Date(`${start}T00:00:00Z`);
      periodStart.setUTCMonth(periodStart.getUTCMonth() + index);
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
      const periodKey = periodStart.toISOString().slice(0, 7);
      await pool.query(
        `INSERT IGNORE INTO accounting_periods (financial_year_id, period_key, start_date, end_date) VALUES (?, ?, ?, ?)`,
        [year.id, periodKey, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)]
      );
    }
  }
}

async function createFinanceSchema() {
  await createTables();
  await seedReferenceData();
  await ensureFinancialYears();
}

async function ensureFinanceSchema() {
  if (!schemaPromise) {
    schemaPromise = createFinanceSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureFinanceSchema, ensureFinancialYears };
