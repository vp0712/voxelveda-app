# Finance ingestion repair progress

Last updated: 2026-09-25 (Australia/Sydney)

## Current Git commit

- Baseline branch: `main`
- Baseline commit: `2a636bb856318aa9202da31ba47abce372a1f815` (`Release Finance Control v14 to Railway`)
- Working tree was clean before this repair began.

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

## Database migrations required

- Link statement sessions to `secure_documents` and the server-verified file hash/MIME/size.
- Add durable ingestion job records, stage/progress/attempt/heartbeat/error fields and idempotency keys.
- Add page/source evidence and row source-location/confidence/original-vs-corrected fields without duplicating the existing review tables.
- Add mapping templates, validation results, duplicate candidates and parser-template metadata only where no authoritative equivalent exists.
- Add constraints/indexes for file/account dedupe, queue claims, status polling and exactly-once posting.

## Production configuration gaps

- The Finance ingestion worker, readiness signal, MySQL queue, stale recovery, bounded retry and dead-letter telemetry are implemented locally; Railway runtime configuration still needs verification.
- Pinned PDF, OCR, English OCR data, image and canvas dependencies are installed and exercised by real-file tests.
- Finance uploads now use restricted `secure_documents` records and private object storage; Railway credentials and the `OBJECT_STORAGE_DOCUMENTS_ENABLED` flag still need pre-deploy verification.
- Malware scanning is optional unless Railway sets the required scanner variables; Finance ingestion must expose this state and fail closed according to policy.
- Redis is used only as an optional distributed rate limiter. The application already has a durable MySQL lease/job framework, so ingestion will reuse that authority rather than create a second queue without need.
- Existing operational gaps remain: live backup telemetry and verified database certificate trust are not configured. No risky production migration will be applied without backup evidence or an explicitly safe additive migration decision.

## Baseline test and startup results

- `npm run lint`: PASS, syntax check passed for 189 files.
- `npm run build`: PASS, all 48 Finance production regression checks passed.
- `npm test`: PASS, complete application/security/Finance suite passed.
- `npm start`: expected local fail-closed result; missing local `.env` caused `JWT_SECRET must be a unique value of at least 32 characters` before database/migrations were contacted.
- Production baseline before this repair: Railway health/readiness returned healthy at deployment `2a636bb856318aa9202da31ba47abce372a1f815`; schema version `20260924_personal_tax_evidence_control` with all critical schemas operational.

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
- [ ] Verify Railway variables, backup state and migration plan; deploy and verify production.

## Deployment status

- Current production remains Finance Control v14 at deployment SHA `2a636bb856318aa9202da31ba47abce372a1f815`.
- This ingestion repair has not yet been deployed.

## Current local verification

- `npm run lint`: PASS (189 JavaScript files).
- `npm run build`: PASS (50 Finance production checks, including generated real-file OCR/parser cases).
- `npm test`: PASS (complete application, security, ERP and Finance suite).
- `npm audit --omit=dev --audit-level=high`: PASS (0 vulnerabilities).
- Real formats proven: CSV, XLSX, OFX, QFX, QIF, selectable-text PDF, PNG OCR, scanned-PDF OCR and password-protected PDF.
- Negative cases proven: mapping required, ambiguous date, malformed row, duplicate row, reconciliation mismatch, corrupt/mislabelled/oversized file and unsupported legacy XLS.

## Production verification evidence

- Baseline `/api/health`: `ok`.
- Baseline `/api/ready`: `ready: true`, all critical services operational, schema `20260924_personal_tax_evidence_control`.
- Deployed `finance-advanced-control.js` contains the v14 15-second budget and abort-controller recovery logic.
- Authenticated upload verification is pending the repaired ingestion path and an authorised MFA session.

## Remaining blockers and assumptions

- No destructive migration is currently planned. All schema work must be additive and backward-compatible.
- A production database backup is not yet externally verified. This blocks destructive/high-risk migrations, not safe local implementation or additive migration preparation.
- Final authenticated live testing requires the owner MFA session.
- HEIC and legacy XLS will be shown as unsupported unless the selected production parser stack proves them with real files and bounded resource controls.
- Any third-party paid OCR provider would require owner selection. The implementation will first use a local, deterministic OCR engine so work can continue without transmitting financial documents to a third party.
