SET @vv_secure_document_deleted_by_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'secure_documents'
    AND column_name = 'deleted_by'
);
SET @vv_secure_document_deleted_by_sql = IF(
  @vv_secure_document_deleted_by_exists = 0,
  'ALTER TABLE secure_documents ADD COLUMN deleted_by INT NULL AFTER deleted_at',
  'SELECT 1'
);
PREPARE vv_secure_document_deleted_by_stmt FROM @vv_secure_document_deleted_by_sql;
EXECUTE vv_secure_document_deleted_by_stmt;
DEALLOCATE PREPARE vv_secure_document_deleted_by_stmt;
