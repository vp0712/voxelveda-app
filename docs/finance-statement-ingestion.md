# Finance statement ingestion

## Purpose

The canonical Finance OS accepts original bank and card statement files, retains them as restricted evidence, extracts transactions on the server, and stages every row for review. Uploading or extracting a statement never posts a transaction automatically.

## Authoritative flow

1. An authenticated user with Finance edit permission and account-level access completes step-up verification.
2. The browser sends one original file as multipart field `file` to `POST /api/finance/intelligence/accounts/:id/statement-imports`.
3. The API applies bounded upload limits, extension/MIME allowlisting, content-signature detection, optional fail-closed ClamAV scanning, server SHA-256 and account-plus-file deduplication.
4. The original is registered as a `RESTRICTED` `secure_documents` record in private Railway S3-compatible storage.
5. A `statement_import_sessions` record and idempotent `finance_statement_import_jobs` row are committed together.
6. The MySQL-leased worker retrieves and re-hashes the stored bytes, classifies the document, performs native extraction or local OCR, normalises exact decimal money, validates balances and currency, and persists page/row source evidence.
7. The existing statement-review tables remain authoritative. Rows are classified as Valid, Uncertain, Duplicate or Rejected; rejected rows can be corrected with an audited original-versus-corrected record.
8. Explicit step-up approval posts selected Valid/Uncertain rows idempotently to `bank_transactions`, writes immutable `bank_transaction_original_data`, and links each review row to its final transaction.

## Supported formats

- CSV and delimited text with automatic headers or a user mapping.
- XLSX using ExcelJS. Formulas are never executed; only cached values are read.
- OFX, QFX and QIF.
- Selectable-text PDF through server PDF.js extraction.
- Scanned PDF, PNG and JPEG through bounded Sharp preprocessing and local Tesseract OCR.
- Password-protected PDF through a bounded encrypted-password resume flow.

Legacy XLS and HEIC are intentionally rejected with actionable conversion guidance. Files are detected by content, not extension alone.

## Durable state and recovery

Session stages include queued, security checking, extracting, OCR required, parsing, validating, needs mapping, needs password, pending review, failed, dead letter, cancelled and posted. The worker records attempts, heartbeats, correlation IDs and safe error summaries. Expired processing claims are recovered; retry uses bounded exponential backoff. The Statement Vault exposes active or failed imports so an operator can resume, retry or cancel without shell access.

Cancelling retains the private source and audit evidence. Original evidence is only removed by the existing controlled statement/data lifecycle.

## Required production configuration

- `FINANCE_INGESTION_WORKER_ENABLED=true`
- `FINANCE_INGESTION_WORKER_REQUIRED=true`
- `FINANCE_STATEMENT_DURABLE_STORAGE_REQUIRED=true`
- `OBJECT_STORAGE_DOCUMENTS_ENABLED=true`
- Railway S3-compatible `OBJECT_STORAGE_*` credentials
- Existing `FINANCE_ENCRYPTION_KEY` for temporary PDF passwords

For fail-closed malware scanning, set `MALWARE_SCANNER_REQUIRED=true` and configure the documented ClamAV host/port values. Never store statement files, PDF passwords, bank credentials, secrets or OCR output in logs.

## Verification

`npm run build` executes the Finance production suite, including actual generated CSV/XLSX/OFX/QFX/QIF/PDF/image payloads, OCR, password-protected PDFs and negative cases. `npm test` executes the full application/security suite. Production verification must also confirm the migration version, object-storage probe, worker readiness, queue metrics, authenticated upload/review/posting, ledger lineage and report/balance refresh.
