# Finance ingestion repair progress

Last updated: 2026-09-26 (Australia/Sydney)

## Current Git release

- Original baseline commit: `2a636bb856318aa9202da31ba47abce372a1f815` (`Release Finance Control v14 to Railway`).
- Current live production commit: `5a1f857ea075b9610d2f1879308a45d78901b2b4` (`Release Finance document compatibility repair`), which includes the Finance v26 ingestion release and its downstream receipt/report compatibility repair.
- Finance v26 rollout commit: `5fa7461ad50a24860591e7477522e9123a99a0e4` (`Release Finance v26 migration retry hotfix`).
- Primary release PR: #254; production migration recovery PRs: #255, #256, #257 and #258; downstream production compatibility/release PRs: #260 and #261.
- Finance v25 baseline incorporated before the v26 release: `d7b8c694bf85598137baf0f21380f4120387fb3a` (`Release Finance statement date integrity v25 r2`).
- Ingestion implementation commit: `e07fd9b`; v25 integration commit: `9d96bab`.

## Existing architecture

- Canonical UI: `public/finance-intelligence.html`, `public/finance-master.js`, and `public/finance-master.css`.
- Canonical API mount: authenticated `/api/finance` routes in `routes/financeRoutes.js`.
- Account and transaction authority: `bank_accounts` and `bank_transactions`; reports query `bank_transactions` rather than browser state.
- Existing statement review authority: `statement_import_sessions` and `statement_import_rows`, with commit provenance in `bank_transaction_original_data`.
- Existing protected-file authority: `secure_documents`, `documentSecurityService`, optional Railway S3-compatible private object storage, authenticated downloads, single-use expiring grants, and ClamAV integration.
- Existing durable background-job framework: MySQL leases, heartbeats, retry/backoff and dead-letter records in `backgroundJobService`.
- Existing privacy model: personal accounts are owner-scoped; business accounts are permission/grant scoped through `financePrivacyService` and `banking_user_account_access`.

## Complete data-flow map

### Baseline flow found

`Browser file picker -> extension-selected browser parser -> browser SHA-256 -> JSON rows -> authenticated/authorised preview endpoint -> statement_import_sessions/rows -> manual review -> step-up commit -> bank_transactions + bank_transaction_original_data -> balances/reports/audit`

### Required repaired flow

`Browser multipart upload -> authentication -> permission and account-object authorisation -> content signature/MIME/size/security validation -> malware scan -> private durable secure_documents storage -> statement import session/job -> durable worker lease -> classification -> native extraction or PDF text/OCR -> coordinate/source evidence -> normalisation -> validation/reconciliation -> multi-level duplicate detection -> database-backed review/correction -> step-up approval/posting lock -> idempotent bank_transactions posting + immutable original data -> balance/reconciliation/report refresh -> audit events`

## Broken connections found and root causes

1. **No statement file upload exists.** The browser sends only parsed JSON rows to `/accounts/:id/statements/preview`. Root cause: the original implementation deliberately made parsing client-side and never integrated `multer`, `secure_documents`, object storage, or the security scanner into statement ingestion.
2. **No durable original statement exists.** `statement_import_files` stores filename and a browser-supplied hash only. Root cause: the preview endpoint accepts claims about a file it never receives.
3. **No ingestion queue or worker exists.** Parsing runs in the browser and the generic durable job framework is not registered for statement work. Root cause: the Finance import was implemented as a synchronous preview workflow.
4. **Scanned PDFs and images are not supported.** There is no server OCR engine or page rendering. Root cause: PDF.js extracts selectable text only and is loaded from a CDN at runtime.
5. **PDF source evidence is discarded.** Browser grouping retains neither words, coordinates, pages nor bounding boxes. Root cause: `pdfLines()` reduces positional items to plain strings before sending rows.
6. **XLSX support is falsely presented.** `parseXlsx()` requires `window.XLSX`, but no XLSX runtime is loaded by the canonical page. Root cause: a source-presence test substituted for a real file test.
7. **File type trust is extension based in the statement wizard.** Root cause: `parseStatement()` dispatches on `file.name`; the server sees no bytes and cannot verify signatures or detected MIME.
8. **Existing tests do not exercise real files.** The import tests assert code strings and a three-record text fixture; no real multipart upload, file persistence, queue, worker, extraction, OCR, database review or posting is executed.
9. **Review counters are not filters.** Valid/Duplicate/Rejected totals render as static KPI cards, Warning is not named Uncertain, and no All filter is offered.
10. **Rejected-row correction is implemented in the API but not wired into the canonical review UI.** The UI exposes selection and commit/reject only, despite `overrideRejectedRow` existing.
11. **Reconciliation evidence is client supplied.** The preview endpoint accepts reconciliation status/difference rather than calculating it from server-extracted rows and statement balances.
12. **Status vocabulary is too small.** Sessions use mainly `PENDING_REVIEW`, `IMPORTED`, and `REJECTED`, so upload/security/queue/extraction/OCR/mapping/validation/posting failure stages cannot be represented accurately.
13. **No parser adapter registry, mapping templates or parser-version pinning for non-PDF files.** Parser metadata can be supplied by the browser and is not bound to a server implementation.
14. **No secure password-protected PDF continuation.** A password challenge and bounded resume path do not exist.
15. **No XLS, HEIC, JPG/JPEG or PNG statement pipeline exists.** The shared upload middleware recognises some of these for other modules, but Finance does not ingest them.
16. **Money is converted through JavaScript `Number` in browser parsers and for reconciliation input.** Server commit uses decimal strings/BigInt helpers, but extraction is not yet integer-minor-unit end to end.
17. **Local startup cannot run without secrets.** The production command fails closed locally because no `.env` provides a valid `JWT_SECRET`; production readiness previously confirmed Railway secrets are present.
18. **Finance receipt recovery fails against the live security-document schema.** The controller writes and selects `secure_documents.deleted_by`, but the authoritative security schema and historical migration created only `deleted_at`. Root cause: the later receipt recovery feature added a soft-delete actor contract without an additive compatibility migration.
19. **Receipt-dependent accountant and report queries can fail on mixed database collations.** They compared `secure_documents.record_id` with a character-cast transaction ID. Root cause: independently created historical tables use different `utf8mb4` collations, so text equality is not portable. The relationship is numeric and now uses `CAST(sd.record_id AS UNSIGNED)=bt.id` consistently.

## Files requiring modification

- `routes/financeRoutes.js`
- `controllers/statementImportController.js`
- `public/finance-master.js`
- `public/finance-master.css`
- `public/finance-intelligence.html`
- `server.js`
- `.env.example`
- `package.json` / `package-lock.json`
- New focused ingestion, parser, validation and worker services under `services/`
- New migration and real-format fixtures/tests under `migrations/` and `scripts/`
- `docs/finance-statement-ingestion.md`
- `services/securityOperationsSchema.js`, `controllers/financeReceiptController.js`, `controllers/financeAccountantHandoverController.js`, and `controllers/financeReportBuilderController.js`

## Database migrations required

- Link statement sessions to `secure_documents` and the server-verified file hash/MIME/size.
- Add durable ingestion job records, stage/progress/attempt/heartbeat/error fields and idempotency keys.
- Add page/source evidence and row source-location/confidence/original-vs-corrected fields without duplicating the existing review tables.
- Add mapping templates, validation results, duplicate candidates and parser-template metadata only where no authoritative equivalent exists.
- Add constraints/indexes for file/account dedupe, queue claims, status polling and exactly-once posting.
- Add the missing nullable `secure_documents.deleted_by` audit column with restart-safe, information-schema-guarded DDL.

## Production configuration gaps

- The Finance ingestion worker, readiness signal, MySQL queue, stale recovery, bounded retry and dead-letter telemetry are deployed. `FINANCE_INGESTION_WORKER_ENABLED`, `FINANCE_INGESTION_WORKER_REQUIRED` and `FINANCE_STATEMENT_DURABLE_STORAGE_REQUIRED` are explicitly enabled in Railway production.
- Pinned PDF, OCR, English OCR data, image and canvas dependencies are installed and exercised by real-file tests.
- Finance uploads use restricted `secure_documents` records and private object storage. Railway currently exposes object-storage provider, bucket, endpoint/region and credential variables, including `OBJECT_STORAGE_DOCUMENTS_ENABLED`.
- Railway currently exposes required ClamAV provider/host/port/fail-closed variables, and the separate malware-scanner service is healthy. Values remain secret and were not copied into this record.
- Redis is used only as an optional distributed rate limiter. The application already has a durable MySQL lease/job framework, so ingestion will reuse that authority rather than create a second queue without need.
- Existing operational gaps remain: live backup telemetry is not externally verified, and database readiness reports encryption capability without active verified certificate trust. The v26 migration is additive, uses `information_schema`-guarded dynamic column/index DDL for MySQL-compatible restart safety, and does not delete or rewrite existing finance data.

## Baseline test and startup results

- `npm run lint`: PASS, syntax check passed for 189 files.
- `npm run build`: PASS, all 48 Finance production regression checks passed.
- `npm test`: PASS, complete application/security/Finance suite passed.
- `npm start`: expected local fail-closed result; missing local `.env` caused `JWT_SECRET must be a unique value of at least 32 characters` before database/migrations were contacted.
- Original production baseline before this repair: Railway health/readiness returned healthy at deployment `2a636bb856318aa9202da31ba47abce372a1f815`.
- Current production baseline before v26 deployment: `d7b8c694bf85598137baf0f21380f4120387fb3a`; schema version `20260924_personal_tax_evidence_control` with critical services operational.

## Test plan

- Unit tests with actual bytes/files for content detection, CSV mapping, XLSX, OFX/QFX, QIF, text PDF, image OCR, scanned PDF OCR, encrypted/corrupt/oversized/mislabelled files, amount/date normalisation and reconciliation.
- Integration tests for multipart upload, account isolation, private storage registration, session/job creation, queue claim/retry/restart, source evidence, review filters, correction, duplicate upload, duplicate rows and exactly-once posting.
- Ledger/report assertions after commit, including balance, account activity, cash flow, reports and exports.
- Production smoke test with sanitised real-format fixtures after migration and worker readiness are verified.

## Implementation status

- [x] Preserve and verify the existing Finance v14 baseline.
- [x] Trace the current browser/API/review/commit/report path.
- [x] Identify the disconnected file, storage, security, worker, extraction and review connections.
- [x] Implement server-side secure upload and private durable file storage.
- [x] Implement durable ingestion jobs and worker observability.
- [x] Implement parser/classifier/normaliser/reconciliation pipeline with source evidence.
- [x] Wire database-backed progress, filtering, correction and retry UI.
- [x] Add actual-byte format, OCR, encrypted/corrupt/oversize, validation and duplicate tests.
- [x] Run local lint, full application test suite, 50-check Finance release build and dependency audit.
- [x] Verify Railway variables and migration plan; deploy and verify production readiness.
- [x] Deploy the additive secure-document compatibility migration and verify receipt/accountant report errors are cleared.
- [ ] Complete one authenticated production statement upload/review/post smoke test with an owner-provided MFA session.

## Deployment status

- Finance statement ingestion v26 remains live in Railway production within deployment `27d7b6d3-a95f-4362-9396-1270e038c42c` from main SHA `5a1f857ea075b9610d2f1879308a45d78901b2b4`; its original successful rollout was deployment `dee1cf41-3eee-4bb3-b213-1506685c7977` from SHA `5fa7461ad50a24860591e7477522e9123a99a0e4`.
- The first rollout correctly failed closed on MySQL-incompatible `ADD COLUMN IF NOT EXISTS`. The hotfix replaced it with guarded dynamic DDL and added a compatibility regression.
- The next rollout exposed a failed-migration checksum retry deadlock. The runner now permits corrected checksum replacement only for incomplete `FAILED`/`RUNNING` entries; `APPLIED`/`BASELINED` migrations remain immutable.
- The corrected migration applied in 6745 ms and the ledger reports schema `20260925_finance_ingestion_pipeline` with 77 migrations verified.
- The additive downstream compatibility migration applied in 644 ms; production now reports schema `20260926_finance_document_compatibility` with 78 migrations verified.

## Current local verification

- `npm run lint`: PASS (189 JavaScript files).
- `npm run build`: PASS on current main (54 Finance production checks, including generated real-file OCR/parser cases).
- `npm test`: PASS (complete application, security, ERP and Finance suite).
- `npm audit --omit=dev --audit-level=high`: PASS (0 vulnerabilities).
- Real formats proven: CSV, XLSX, OFX, QFX, QIF, selectable-text PDF, PNG OCR, scanned-PDF OCR and password-protected PDF.
- Negative cases proven: mapping required, ambiguous date, malformed row, duplicate row, reconciliation mismatch, corrupt/mislabelled/oversized file and unsupported legacy XLS.

## Production verification evidence

- `/api/health`: HTTP 200 after the backend became ready.
- `/api/ready`: HTTP 200, `ready: true`, schema `20260926_finance_document_compatibility`, deployment SHA `5a1f857ea075b9610d2f1879308a45d78901b2b4`.
- `finance_ingestion_worker`, background workers, migrations, Finance schema, database and all other critical services report `OPERATIONAL`.
- Runtime evidence verifies Redis rate limiting, ClamAV malware scanning, Railway S3 private object storage and the least-privileged `voxelveda_app` database identity.
- The deployed Finance client contains multipart durable upload, job polling, password/mapping recovery, protected review and original-statement evidence paths. Both ingestion paths reject unauthenticated calls with HTTP 401.
- Post-release logs contain zero `secure_documents.deleted_by` missing-column errors, zero mixed-collation errors and zero unexpected runtime errors for the new deployment.
- Authenticated upload/review/post verification remains pending an authorised MFA code; the production test account correctly requires MFA and no code was fabricated or bypassed.

## Remaining blockers and assumptions

- No destructive migration was used. All v26 schema work is additive and backward-compatible.
- A production database backup is not yet externally verified. This blocks destructive/high-risk migrations, not safe local implementation or additive migration preparation.
- Final authenticated upload/review/post testing requires the owner MFA session.
- HEIC and legacy XLS will be shown as unsupported unless the selected production parser stack proves them with real files and bounded resource controls.
- Any third-party paid OCR provider would require owner selection. The implementation will first use a local, deterministic OCR engine so work can continue without transmitting financial documents to a third party.
