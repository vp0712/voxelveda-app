UPDATE bank_transactions
SET category='Cash', classification_status='CLASSIFIED'
WHERE (category IS NULL OR TRIM(category)='')
  AND (
    UPPER(CONCAT_WS(' ', COALESCE(description,''), COALESCE(merchant_name,''), COALESCE(reference,''))) REGEXP '(^|[^A-Z0-9])(ATM|CASH WITHDRAWAL|CASH WDL|CASH OUT|CASH ADVANCE|BRANCH WITHDRAWAL|WITHDRAWAL CASH|CASH DISPENSED)([^A-Z0-9]|$)'
  );
