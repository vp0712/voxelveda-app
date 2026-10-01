-- Finance account market segmentation
-- Keep every real-world bank account as a distinct ledger boundary while
-- allowing country/market and account-type grouping in the UI.

ALTER TABLE bank_accounts
  ADD COLUMN bank_market VARCHAR(20) NOT NULL DEFAULT 'AUSTRALIA' AFTER institution,
  ADD COLUMN bank_country_code CHAR(2) NOT NULL DEFAULT 'AU' AFTER bank_market,
  ADD COLUMN routing_code_masked VARCHAR(40) NULL AFTER bsb_masked,
  ADD INDEX idx_bank_accounts_market_type_status (bank_market, account_type, status);

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
