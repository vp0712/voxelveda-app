# Voxel Veda Enterprise Deep Audit

## Audit baseline

- Repository: `vp0712/voxelveda-app`
- Latest fetched `origin/main` at audit start: `a1fee06e4f878f8af9d7c18f52d983e57723b1f0`
- Wave A branch: `feature/enterprise-wave-a-bootstrap`
- Scope: root application files plus `config`, `controllers`, `controllers/qms`, `middleware`, `migrations`, `public`, `routes`, `scripts`, `services`, `utils`, `ios`, `android`, and `.github/workflows`.
- Binary policy: image, font, PDF, and archive bytes were not interpreted as source. Their path, type, size, and deployment presence are inventoried.
- Machine-readable evidence: `docs/ENTERPRISE_ARCHITECTURE_INVENTORY.json`

The deterministic inventory currently records 343 text/source files, 76,403 lines, 457 declared HTTP routes, 20 SQL migrations, 43 worker timer sites, and 50 binary assets. Static matches are triage inputs, not proof by themselves: the inventory intentionally labels the heuristic used.

## Local verification evidence

- `npm run check`: passed for 135 JavaScript files.
- `npm test`: passed, including Wave A, existing security, identity, finance, QMS, Trash, workflow, procurement, source, secret, injection, and domain smoke checks.
- `npm run security:audit`: registry-backed audit passed with zero reported vulnerabilities.
- Real local MySQL migration run: 20 discovered, 20 applied, schema version `20260911_enterprise_bootstrap_readiness`.
- Real local MySQL repeat run: 20 discovered, 0 applied, 20 checksum-verified/skipped.
- Local boot smoke: schemas completed before `Server ready`; `/api/health` returned 200, `/api/ready` returned 200/ready with the expected schema version, and anonymous detailed readiness returned 401.

These results are local evidence only. CI, Railway deployment, production runtime, database TLS, SMTP, backup, malware scanner, Redis, DNS/TLS, WebAuthn, and object-storage provider verification remain separate states.

## Assurance state

| Control | Code present | Wired | Locally tested | CI verified | Deployed | Runtime verified | Provider verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ordered migration runner | Yes | Yes | Yes | Pending | No | Pending | Not applicable |
| MySQL advisory migration lock | Yes | Yes | Yes | Pending | No | Pending | Not applicable |
| `DATABASE_URL` parsing | Yes | Yes | Yes | Pending | No | Pending | Not applicable |
| Database TLS enforcement | Yes | Yes | Yes | Pending | No | Pending | No |
| Liveness/readiness separation | Yes | Yes | Yes | Pending | No | Pending | Not applicable |
| Restricted readiness detail | Yes | Yes | Yes | Pending | No | Pending | Not applicable |
| SMTP runtime verification | Yes | Yes | Syntax tested | Pending | No | Pending | No |
| Redis distributed limiter | No | No | No | No | No | No | No |
| Malware scan adapter | Queue states only | No verified adapter | No | No | No | No | No |
| Durable object storage adapter | No | No | No | No | No | No | No |

No deployment or provider state in this document should be promoted without release evidence.

## Findings

### A-001: HTTP traffic accepted before critical initialization

- Severity: Critical
- File: `server.js`
- Function: process entrypoint
- Risk: The old process called `app.listen` before migrations and schema initialization, and initialization errors were logged without stopping the process. A deployment could answer health checks and accept normal traffic against an incomplete database.
- Evidence: Baseline `server.js` bound the port before every `ensure*Schema()` promise and started schedulers immediately.
- Recommended fix: Use one awaited bootstrap path: validate, connect, lock/migrate, initialize critical schemas/services/workers, then listen. Exit on a critical failure.
- Test requirement: Assert source ordering, simulate migration failure, and verify that no listener is created.
- External dependency: Railway startup/restart log verification.
- Status: Fixed in Wave A; deployment proof pending.

### A-002: No authoritative migration ledger or concurrency lock

- Severity: Critical
- File: `migrations/`, previously no runner
- Function: deployment database evolution
- Risk: Runtime DDL and manually applied scripts could diverge between replicas and environments. No checksum prevented modified historical migrations.
- Evidence: Nineteen historical SQL files existed without `schema_migrations`; schema services ran DDL independently.
- Recommended fix: Ordered checksummed migrations under a MySQL advisory lock, with applied/failed status and deployment SHA.
- Test requirement: First apply, second-run skip, checksum mismatch failure, lock release, ordered execution, and real-MySQL smoke.
- External dependency: Production database migration during Railway deployment.
- Status: Fixed in Wave A code; real deployment proof pending.

### A-003: `DATABASE_URL` documented but ignored

- Severity: High
- File: `config/db.js`, `.env.example`
- Function: MySQL pool configuration
- Risk: Railway could provide a valid connection URL while the app silently connected using unrelated defaults.
- Evidence: Baseline pool read only `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT`.
- Recommended fix: Parse only `mysql://` or `mysqls://`, decode credentials, reject malformed/unsupported URLs, and keep safe non-secret configuration metadata.
- Test requirement: URL, encoded credential, port, scheme, fallback, and secret-redaction cases.
- External dependency: Verify the actual Railway variable format.
- Status: Fixed in Wave A code; Railway variable verification pending.

### A-004: TLS readiness flag did not configure MySQL TLS

- Severity: High
- File: `config/db.js`, `config/productionReadiness.js`
- Function: database transport
- Risk: `DB_TLS_REQUIRED=true` could appear ready while the pool had no `ssl` option.
- Evidence: Baseline pool options had no TLS configuration and readiness inspected only environment text.
- Recommended fix: Configure TLS 1.2+, require certificate verification in production, support a private CA, and fail startup if the active session reports no TLS cipher when TLS is required.
- Test requirement: Pool option tests plus live provider connection evidence.
- External dependency: Railway/MySQL provider certificate chain and TLS support.
- Status: Fixed in Wave A code; provider verification pending.

### A-005: Environment presence could be mistaken for operational control state

- Severity: High
- File: `config/productionReadiness.js`, `controllers/securityDashboardController.js`
- Function: readiness and security dashboard
- Risk: A Redis, scanner, backup, SMTP, WebAuthn, or storage environment variable could create a misleading green indicator without adapter initialization or provider evidence.
- Evidence: Baseline readiness used Boolean environment checks; the scanner implementation only established queue states.
- Recommended fix: Use the shared states `NOT_CONFIGURED`, `CONFIGURED`, `INITIALIZING`, `OPERATIONAL`, `DEGRADED`, `FAILED`, and `EXTERNALLY_VERIFIED`. Provider-backed controls remain configured until verified.
- Test requirement: State transition and safe serialization tests; provider failures must not become operational.
- External dependency: Redis, malware scanner, backup, SMTP, WebAuthn, and storage provider adapters.
- Status: Core truth model fixed in Wave A; provider adapters remain deferred to their named waves.

### A-006: Liveness exposed deployment facts but did not represent readiness

- Severity: High
- File: `app.js`
- Function: `GET /api/health`
- Risk: Railway could route traffic because the process was alive while database/schema/services were not ready.
- Evidence: Baseline health always returned `status: ok`; no `/api/ready` existed.
- Recommended fix: Keep health process-only; add safe public readiness with HTTP 503 until ready and a permission-restricted detailed endpoint.
- Test requirement: Response status, public field allowlist, no credentials/host identity, and authentication on details.
- External dependency: Configure Railway to use `/api/ready` for readiness if supported.
- Status: Fixed in Wave A code; Railway health-check configuration pending.

### A-007: Request paths still perform schema DDL

- Severity: High
- File: controllers including `attendanceController.js`, `competitorController.js`, `expenseController.js`, and `dashboardController.js`
- Function: request-time `ensure*` paths
- Risk: Requests can acquire metadata locks, hide failed deployment migrations, create latency spikes, and produce inconsistent replica behavior.
- Evidence: Inventory reports 132 direct DDL source lines in controllers/routes/middleware and 148 controller calls to schema initializers.
- Recommended fix: Move authoritative DDL into additive migrations and gradually convert runtime guards to schema-version assertions.
- Test requirement: Fresh/current database migration tests and request tests proving no DDL is executed.
- External dependency: Production migration evidence and rollback plan.
- Status: Deferred intentionally. Compatibility guards remain until the new deployment path is proven.

### A-008: Errors are intentionally or accidentally swallowed in many paths

- Severity: High
- File: multiple controllers/services; concentrated in legacy runtime DDL
- Function: `.catch(() => {})` and empty catch handlers
- Risk: Genuine schema, rollback, filesystem, token-revocation, or telemetry failures can become invisible.
- Evidence: Inventory reports 169 narrow static candidates. Confirmed examples include runtime `ALTER TABLE` catches in attendance, competitor, expense, and dashboard controllers.
- Recommended fix: Classify expected idempotent errors explicitly, log redacted operational failures, and propagate critical failures.
- Test requirement: Fault-injection tests for DDL, transactions, filesystem cleanup, and security event writes.
- External dependency: Central structured logging is scheduled for Wave L.
- Status: Startup/admin bootstrap swallowing fixed in Wave A; broad remediation deferred by domain.

### A-009: Schedulers are process-local and replica-unsafe

- Severity: High
- File: `weeklyTimesheetScheduler.js`, `trashPurgeService.js`, `workflowEscalationService.js`, `emailQueueWorker.js`
- Function: recurring background work
- Risk: Multiple Railway replicas may send duplicate emails, repeat escalation, or race purge work.
- Evidence: Timers use local busy flags; there is no durable lease shared across replicas.
- Recommended fix: Introduce advisory/durable job leases, run records, retries, and dead-letter state before scaling.
- Test requirement: Concurrent worker tests against real MySQL.
- External dependency: Multi-replica Railway test environment.
- Status: Deferred to Wave B. Readiness reports the limitation rather than claiming distributed operation.

### A-010: CSP still permits inline scripts

- Severity: High
- File: `middleware/securityMiddleware.js`, inline handlers in `public/`
- Function: browser content security policy
- Risk: `script-src 'unsafe-inline'` weakens protection against injected script.
- Evidence: Enforced policy includes inline script permission; report-only policy still permits inline styles.
- Recommended fix: Inventory inline handlers, move behavior into modules, use nonce only where required, and remove script `unsafe-inline` after regression testing.
- Test requirement: Browser E2E across login/admin/staff/QMS and CSP telemetry tests including Safari format.
- External dependency: None.
- Status: Deferred to Wave B; policy has not been weakened.

### A-011: Public endpoints share broad process-local abuse controls

- Severity: High
- File: `app.js`, `middleware/securityMiddleware.js`
- Function: public RFQ, AI lead, shift QR, CoC verification, QR rendering, and auth lifecycle endpoints
- Risk: Expensive QR rendering and write endpoints can consume shared process resources; one policy cannot express endpoint risk.
- Evidence: A global in-memory `Map` limiter precedes most routes; dedicated endpoint contracts are inconsistent.
- Recommended fix: Add endpoint-specific limits, body contracts, dedupe, anti-enumeration, and a Redis adapter with a documented failure mode.
- Test requirement: Boundary, bypass, expiry, shared-counter, and provider-failure tests.
- External dependency: Redis before multi-replica production.
- Status: Deferred to Wave B.

### A-012: Public customer registration bypasses the shared password policy

- Severity: High
- File: `controllers/authController.js`, `public/register.html`
- Function: `register`
- Risk: A six-character password path is materially weaker than other account creation and reset paths.
- Evidence: Controller checks `password.length < 6`; the form advertises six characters.
- Recommended fix: Route every password creation/update path through `validatePassword` while preserving generic responses.
- Test requirement: Registration, invite, reset, admin-created user, and change-password parity tests.
- External dependency: None.
- Status: Deferred to Wave B to avoid mixing auth behavior into bootstrap PR.

### A-013: QMS and governance lists use fixed limits instead of pagination

- Severity: Medium
- File: `controllers/qms/recordController.js`, `qualityReleaseController.js`, `governanceController.js`, `inspectionController.js`, `qmsOperationsController.js`
- Function: list/search endpoints
- Risk: Fixed `LIMIT 500` responses become slow and incomplete without a client-visible cursor or stable navigation.
- Evidence: Multiple QMS lists return the latest 500 records directly.
- Recommended fix: Permission-filtered cursor pagination with indexed filters and stable ordering.
- Test requirement: Boundary, cursor stability, authorization-before-return, and representative-volume tests.
- External dependency: Representative production-like data volume.
- Status: Deferred to Wave C.

### A-014: Procurement workspace loads large cross-domain snapshots

- Severity: High
- File: `services/procurementService.js`
- Function: workspace aggregation
- Risk: Parent lists and child collections are loaded in broad batches, creating scaling and consistency pressure.
- Evidence: Supplier limit 500 and multiple parent resources at limit 100 are composed into one workspace response.
- Recommended fix: Summary plus small recent subsets; expose paginated resource endpoints and indexed queries.
- Test requirement: Query-count assertions and 50k-record performance fixtures.
- External dependency: Production-like MySQL dataset.
- Status: Deferred to procurement scalability phase.

### A-015: Direct destructive deletion needs domain-specific retention review

- Severity: High
- File: `attendanceController.js`, `invoiceController.js`, `stockController.js`, `financeOperationsController.js`, plus controlled security/trash services
- Function: delete/correction workflows
- Risk: Business evidence can be removed without the correct void, reverse, archive, or Trash semantics.
- Evidence: Confirmed direct deletes include attendance, invoice payments/items, stock movements, and supplier bill items. MFA factor deletion is a separate intentional security lifecycle case.
- Recommended fix: Classify each path; use reversal/void for financial and inventory history, Trash only for eligible drafts, and permanent deletion only for documented ephemeral/security state.
- Test requirement: Retention, audit, authorization, reversal balance, and concurrent-action tests.
- External dependency: Business retention policy approval.
- Status: Deferred by domain; no destructive history rewrite was made in Wave A.

### A-016: Frontend bundles are too large for low-risk continued expansion

- Severity: Medium
- File: `public/admin-dashboard.js`, `public/style.css`, `public/staff.js`, `public/advanced-theme.css`
- Function: admin/staff frontend
- Risk: Monolithic files increase regression risk, duplicate behavior, and make responsive/theme changes difficult to verify.
- Evidence: Current sizes are approximately 492 KB, 340 KB, 136 KB, and 119 KB respectively.
- Recommended fix: Extract feature modules and a token/layout/component design system incrementally. Do not rewrite all portals in one PR.
- Test requirement: Playwright behavior and visual checks at required mobile/tablet/desktop viewports.
- External dependency: Browser/device test matrix.
- Status: Deferred to Wave E. The requested whole-app theme and layout redesign is explicitly the final presentation wave after functional remediation.

## Wave A release gates

Before merge, Wave A must still prove:

1. All historical migrations parse and execute on a representative MySQL database.
2. `npm run check`, `npm test`, and `npm run security:audit` pass.
3. Security CI is green on the PR.
4. Railway deploy reports the merged SHA.
5. `/api/health` is alive and `/api/ready` is ready with the expected schema version.
6. Startup logs show migrations and critical schemas before `Server ready`.
7. Restricted readiness rejects anonymous access and accepts an authorized security administrator.

The next wave must rescan latest `main` before implementation.
