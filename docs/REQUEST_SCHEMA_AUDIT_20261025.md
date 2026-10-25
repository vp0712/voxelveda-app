# Original register schema audit

Baseline: `b3707b2376aba5b080b54d723b5dcb6dcfceedd1`.

The inventory searched active controllers, middleware, services and utilities for
schema-writing queries and followed their initialization callers. Calling a
memoised compatibility initializer in a handler is not the same as executing DDL
on every request.

| Reproduction / cause | Affected original workflow | Repair | Verification |
| --- | --- | --- | --- |
| Competitor list/save/archive executed a table CREATE and fourteen ALTER attempts on every request; all ALTER errors were swallowed. | Competitor register, authorised original routes | Move original definitions to the ordered current migration; replace the handler helper with a cached read-only assertion. Missing/incompatible schema returns a clear 503 and logs internal diagnostics. | `original-register-schema-test.js`; isolated MySQL fresh/upgrade matrix |
| Customer and meeting list/save/archive executed CREATE per request. | Customers; manager and own meetings | Same migration/assertion boundary; preserve existing validation, ownership, archive and audit behavior. | Original core-workflow and migration tests |
| Settings read/update created its table, including inside the update transaction. | Authorised company profile settings | Migrate and assert the existing table without changing its safe settings allowlist. | Retained boundary tests |
| Access-attempt list and denied-input logging duplicated a table CREATE. | Authorised access-attempt review; permission-denied audit logging | One migrated table; shared read-only observation. Denied actions remain denied when audit storage is unavailable. | Schema helper inventory test; original permission regressions |
| Announcement, staff-message and staff-work-request helpers repeated CREATE/ALTER statements without memoisation. | Organisation notices, private staff messages, staff requests | Migrate these original structures and assert them; retain role/recipient rules and structured error outcomes. | Schema helper tests; original workflow regressions |

## Migration boundary and preservation

The existing 82 historical SQL files are unchanged and remain checksum-only under
`runMigrations({ pool, verifyOnly: true })`. The separate non-recursive directory
`migrations/retained` contains only explicitly registered current original
migrations. It uses the existing cross-replica advisory lock, checksum ledger,
ordered execution and durable APPLIED/FAILED outcomes. Current migrations reject
unregistered files and destructive statements. A changed applied checksum fails
closed.

`20261025_original_request_schema.sql` covers only `competitors`,
`access_attempts`, `customers`, `meetings`, `app_settings`, `announcements`,
`staff_messages` and `staff_work_requests`. Existing columns and values are never
rewritten. Missing historical dates, owners and descriptive/status fields remain
NULL; new tables retain their original create-time defaults. Missing identity or
essential original business fields cause an explicit compatibility failure.
Source files, attachments, IDs, audit history, retired data and encryption keys
are not touched. The changes remain additive for previous-release rollback.

Startup completes the current migrations and read-only assertions before serving
requests. Requests perform no schema writes for these eight registers. Failed
observations are retryable; successful observations are shared per pool or
connection. Internal missing-column/provider details stay in logs, not request
responses.

## Other active schema paths

| Classification | Paths | Behavior retained |
| --- | --- | --- |
| Memoised original controller compatibility | `attendanceController`, `complianceController`, `dashboardController`, `expenseController`, `invoiceController`, `materialController`, `rosterController`, `stockController`, `supplierController`; primary task-table initializer | A shared promise initializes once, clears on failure, and is called during startup. These are not per-request DDL defects. Existing historical compatibility behavior remains. |
| Memoised original service/schema initialization | `attendanceMobileSchema`, `careersSchema`, `checkoutSummarySchema`, `coreAuditSchema`, `documentDeliveryService`, `emailQueueSchema`, `employeeIdentitySchema`, `hrAdministrationSchema`, `notificationSchema`, `procurementImportSchema`, `procurementReportService`, `procurementSchema`, `profilePhotoService`, QMS schema services, `rfqSchema`, security/operational-trust schemas, `trashSchema`, `userLifecycleService`, `weeklyTimesheetDeliverySchema`, `workflowSchema`, `workforceSchema` | Shared promise initialization; the checkout-category service uses `pending`, and attendance-display links use a per-database WeakMap. Existing startup-compatible structures are retained. |
| Retained governance initialization | `assuranceSchema`, `enterpriseControlPlaneSchema`, related security schema services | Initializers remain memoised and retain existing route/permission/retirement gates. |
| Scoped document-reference compatibility | `utils/secureDocumentReference.js` | Called only from memoised QMS schema initializers. It inspects nullable original document-reference fields and permits a verified widening to UUID-compatible VARCHAR; it is not called per document request. |
| Ordered migration ledger | `services/migrationRunner.js` | Ledger bootstrap at startup under the existing advisory lock; historical migrations are never replayed by app startup. |
| Explicit optional administrator bootstrap | `utils/seedAdmin.js` | Only the existing `ENABLE_ADMIN_BOOTSTRAP=true` startup path invokes it. It is not an HTTP request path and this release does not enable it. |

Existing memoised compatibility initializers still contain legacy duplicate-column
handling. This audit does not claim that every startup schema initializer has
been converted to a migration.

## Disposable MySQL proof

Run `scripts/original-register-schema-mysql-test.js` in its own fresh local
`voxelveda_schema_test` database with `NODE_ENV=test`, `SCHEMA_DB_TEST=true`, and
`SCHEMA_FIXTURE_MODE=fresh` or `upgrade`. Each matrix case requires a fresh schema
and refuses remote/inherited application URLs. It tests the exact current SQL,
three concurrent runners, one durable application, restart idempotence, checksum
rejection, original value/ID preservation, and an unchanged retired fixture.
No table drops or cleanup mutations are needed. Test execution results belong in
the final candidate's CI evidence; code presence alone is not a MySQL pass.
