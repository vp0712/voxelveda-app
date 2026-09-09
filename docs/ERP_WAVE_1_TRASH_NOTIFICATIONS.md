# ERP Wave 1: Trash and Notification Centre

This wave adds the shared deletion and notification foundation without changing protected accounting, security, or approved quality records.

## Enterprise Trash

- Eligible records move to `trash_items` and disappear from their normal module immediately.
- Retention is exactly 15 days. `purge_at` is calculated from the recorded deletion time.
- The hourly purge worker processes bounded batches and records retryable failures.
- Restore verifies the Trash integrity hash and checks supported unique identifiers before reactivating a record.
- Staff see only eligible Trash they created; managers can additionally recover eligible Trash created by their active direct reports.
- Organisation-wide permanent deletion requires `MANAGE_TRASH`, step-up authentication, and the exact confirmation `PERMANENTLY DELETE`.
- Critical security notifications receive a retention hold and cannot be manually or automatically purged.
- Suppliers referenced by retained financial records receive a retention hold. Unreferenced supplier attachment rows and stored blobs are removed with the final supplier purge; attachments remain available after restore during retention.
- Purged Trash rows remain as non-active tombstones so immutable audit references are preserved.

Eligible types in this wave are customers, suppliers, meetings, tasks, announcements, staff messages, staff work requests, and notifications. Invoices, payments, accounting postings, audit evidence, issued quality records, and final regulatory records are intentionally excluded. Those records must use controlled void, supersede, archive, cancel, or revoke workflows.

## Notification Centre

- Notifications are scoped to the authenticated user at the query boundary.
- Users can filter, mark read or unread, clear, move notifications to Trash, and restore them.
- Admin and staff bell panels use API-backed unread counts and an eight-second Undo action.
- Preferences store per-category in-app, email, push, quiet-hours, and digest settings. Disabled in-app categories are excluded from the bell and unread count; email/push digest delivery remains reserved for dedicated delivery-channel workers.
- Staff tasks, announcements, staff messages, staff work requests, and timesheet workflow events now create linked notifications.

## Operations

Optional environment settings:

```text
TRASH_PURGE_INTERVAL_MS=3600000
TRASH_PURGE_BATCH_SIZE=50
```

Run before deployment:

```text
npm ci
npm run check
npm test
npm run security:audit
```

Apply `migrations/20260909_erp_wave1_trash_notifications.sql` through the controlled production migration process. Runtime schema guards are additive and remain in place for safe application startup.

After deployment, verify `/api/health`, inspect startup logs for both schema-ready messages, and test delete, restore, read/unread, user isolation, retention countdown, and step-up permanent deletion with non-production records.
