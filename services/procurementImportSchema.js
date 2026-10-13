'use strict';
const pool=require('../config/db');
let schemaPromise;
const STATEMENTS=[
 `CREATE TABLE IF NOT EXISTS procurement_entry_sequences (
   year_value INT NOT NULL PRIMARY KEY, next_value BIGINT UNSIGNED NOT NULL DEFAULT 1
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_import_batches (
   id CHAR(36) PRIMARY KEY, owner_user_id BIGINT NOT NULL, created_by BIGINT NOT NULL,
   status VARCHAR(40) NOT NULL DEFAULT 'UPLOADED', revision INT UNSIGNED NOT NULL DEFAULT 1,
   request_key CHAR(64) NULL, request_hash CHAR(64) NOT NULL, preview_token CHAR(64) NULL,
   confirmed_at DATETIME NULL, confirmed_by BIGINT NULL,
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_import_request(request_key), KEY idx_procurement_import_owner(owner_user_id,created_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_import_files (
   id CHAR(36) PRIMARY KEY, batch_id CHAR(36) NOT NULL, ordinal_no INT UNSIGNED NOT NULL,
   original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(120) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL,
   content_sha256 CHAR(64) NOT NULL, source_document_id CHAR(36) NULL,
   storage_type VARCHAR(30) NULL, object_key TEXT NULL, original_bytes LONGBLOB NULL,
   format VARCHAR(30) NULL, status VARCHAR(40) NOT NULL DEFAULT 'STORED', scan_status VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
   extraction_json JSON NULL, mapping_json JSON NULL, error_code VARCHAR(100) NULL, error_message VARCHAR(500) NULL,
   duplicate_of_file_id CHAR(36) NULL, processing_claim_token CHAR(36) NULL, processing_started_at DATETIME NULL, processing_expires_at DATETIME NULL,
   attempts INT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_import_file(batch_id,ordinal_no), KEY idx_procurement_file_batch(batch_id),
   KEY idx_procurement_file_processing(status,processing_expires_at), KEY idx_procurement_file_hash(content_sha256)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_import_rows (
   id CHAR(36) PRIMARY KEY, batch_id CHAR(36) NOT NULL, file_id CHAR(36) NOT NULL,
   sheet_name VARCHAR(255) NOT NULL, source_row INT UNSIGNED NOT NULL,
   raw_json JSON NOT NULL, values_json JSON NULL, errors_json JSON NULL, warnings_json JSON NULL,
   fingerprint CHAR(64) NULL, status VARCHAR(40) NOT NULL DEFAULT 'PENDING_MAPPING',
   revision INT UNSIGNED NOT NULL DEFAULT 1, reviewed_by BIGINT NULL, reviewed_at DATETIME NULL,
   entry_id CHAR(36) NULL, duplicate_of_row_id CHAR(36) NULL,
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_source_row(file_id,sheet_name,source_row), KEY idx_procurement_rows_batch(batch_id,status), KEY idx_procurement_rows_file(file_id,status)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_records (
   id CHAR(36) PRIMARY KEY, record_no VARCHAR(80) NOT NULL,
   owner_user_id BIGINT NOT NULL, classification VARCHAR(40) NOT NULL,
   title VARCHAR(255) NOT NULL, category VARCHAR(120) NULL, priority VARCHAR(30) NULL, phase VARCHAR(120) NULL, reference VARCHAR(160) NULL, supplier_id BIGINT NULL, supplier_name VARCHAR(255) NULL,
   issue_date DATE NULL, due_date DATE NULL, currency CHAR(3) NULL,
   item_code VARCHAR(120) NULL, description TEXT NOT NULL, quantity DECIMAL(14,3) NOT NULL,
   unit VARCHAR(40) NULL, unit_price DECIMAL(18,2) NULL, tax_rate DECIMAL(7,3) NULL,
   net_amount DECIMAL(18,2) NULL, tax_amount DECIMAL(18,2) NULL, total_amount DECIMAL(18,2) NULL,
   notes TEXT NULL, status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', revision INT UNSIGNED NOT NULL DEFAULT 1,
   import_batch_id CHAR(36) NULL, import_file_id CHAR(36) NULL, import_row_id CHAR(36) NULL, source_document_id CHAR(36) NULL,
   fingerprint CHAR(64) NULL, request_key CHAR(64) NULL, request_hash CHAR(64) NULL,
   created_by BIGINT NOT NULL, updated_by BIGINT NOT NULL, archived_at DATETIME NULL, archived_by BIGINT NULL, archive_reason VARCHAR(1000) NULL,
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_record_no(record_no), UNIQUE KEY uq_procurement_record_request(request_key), UNIQUE KEY uq_procurement_record_import_row(import_row_id),
   KEY idx_procurement_record_scope(owner_user_id,archived_at,created_at), KEY idx_procurement_record_supplier(supplier_id,issue_date), KEY idx_procurement_record_hash(owner_user_id,fingerprint)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_import_commits (
   id CHAR(36) PRIMARY KEY, batch_id CHAR(36) NOT NULL, preview_token CHAR(64) NOT NULL,
   selection_hash CHAR(64) NOT NULL, entry_ids_json JSON NOT NULL, counts_json JSON NOT NULL,
   created_by BIGINT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_import_commit(batch_id,preview_token)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
 `CREATE TABLE IF NOT EXISTS procurement_record_revisions (
   id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, record_id CHAR(36) NOT NULL, revision INT UNSIGNED NOT NULL,
   action VARCHAR(40) NOT NULL, old_json JSON NULL, new_json JSON NOT NULL, changed_by BIGINT NOT NULL,
   reason VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_procurement_record_revision(record_id,revision), KEY idx_procurement_record_history(record_id,created_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
function ensureProcurementImportSchema(){
 if(!schemaPromise)schemaPromise=(async()=>{for(const sql of STATEMENTS)await pool.query(sql);})().catch(error=>{schemaPromise=null;throw error;});
 return schemaPromise;
}
module.exports={ensureProcurementImportSchema,STATEMENTS};
