-- Finance account market segmentation.
-- Idempotent because MySQL DDL auto-commits: a retry after an interrupted
-- deployment must not fail because one field was already created.

SET @vv_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='bank_accounts' AND column_name='bank_market') = 0,
  'ALTER TABLE bank_accounts ADD COLUMN bank_market VARCHAR(20) NOT NULL DEFAULT ''AUSTRALIA'' AFTER institution',
  'SELECT 1'
);
PREPARE vv_stmt FROM @vv_sql;
EXECUTE vv_stmt;
DEALLOCATE PREPARE vv_stmt;

SET @vv_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='bank_accounts' AND column_name='bank_country_code') = 0,
  'ALTER TABLE bank_accounts ADD COLUMN bank_country_code CHAR(2) NOT NULL DEFAULT ''AU'' AFTER bank_market',
  'SELECT 1'
);
PREPARE vv_stmt FROM @vv_sql;
EXECUTE vv_stmt;
DEALLOCATE PREPARE vv_stmt;

SET @vv_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='bank_accounts' AND column_name='routing_code_masked') = 0,
  'ALTER TABLE bank_accounts ADD COLUMN routing_code_masked VARCHAR(40) NULL AFTER bsb_masked',
  'SELECT 1'
);
PREPARE vv_stmt FROM @vv_sql;
EXECUTE vv_stmt;
DEALLOCATE PREPARE vv_stmt;

SET @vv_sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name='bank_accounts' AND index_name='idx_bank_accounts_market_type_status') = 0,
  'CREATE INDEX idx_bank_accounts_market_type_status ON bank_accounts (bank_market, account_type, status)',
  'SELECT 1'
);
PREPARE vv_stmt FROM @vv_sql;
EXECUTE vv_stmt;
DEALLOCATE PREPARE vv_stmt;

UPDATE bank_accounts
   SET bank_market = CASE
       WHEN UPPER(currency) = 'INR' THEN 'INDIA'
       WHEN UPPER(currency) = 'AUD' THEN 'AUSTRALIA'
       ELSE 'OTHER'
     END,
       bank_country_code = CASE
       WHEN UPPER(currency) = 'INR' THEN 'IN'
       WHEN UPPER(currency) = 'AUD' THEN 'AU'
       ELSE 'XX'
     END
 WHERE bank_market IS NULL
    OR bank_market = ''
    OR bank_country_code IS NULL
    OR bank_country_code = ''
    OR (bank_market = 'AUSTRALIA' AND UPPER(currency) = 'INR');
