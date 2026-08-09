# Timesheet Workflow and Hostinger Email

## Workflow

Weekly timesheets use the following controlled lifecycle:

1. `DRAFT` - generated from attendance and still editable.
2. `PENDING_APPROVAL` - submitted by the employee and frozen for review.
3. `CORRECTION_REQUIRED` - returned by a manager with a required reason.
4. `CORRECTION_RESUBMITTED` - corrected and returned to the approval queue.
5. `APPROVED` - approved values are frozen and copied to `payroll_ready`.
6. `REJECTED` - rejected with a required reason.
7. `ARCHIVED` - retained for historical reporting.

Every submission and decision creates an immutable `timesheet_versions` snapshot. Manager actions are also written to `timesheet_approvals`, `audit_logs`, and `activity_logs`. Approval and payroll creation run in one database transaction so a partial approval cannot be saved.

## Main API endpoints

- `GET /api/attendance/timesheets?status=ALL`
- `GET /api/attendance/timesheets/:id`
- `POST /api/attendance/timesheets/:id/submit`
- `POST /api/attendance/timesheets/:id/approve`
- `POST /api/attendance/timesheets/:id/reject`
- `POST /api/attendance/timesheets/:id/correction`
- `POST /api/attendance/timesheets/:id/amend`
- `GET /api/attendance/timesheets/payroll-ready`

Employees may submit only their own timesheets. Admin and authorised managers may review and decide timesheets. Server-side permission checks remain authoritative even if a button is hidden in the browser.

## Hostinger SMTP

Configure these Railway variables without committing secrets:

```text
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USERNAME=info@voxelveda.com
SMTP_PASSWORD=<Hostinger mailbox password>
MAIL_FROM_NAME=Voxel Veda
MAIL_FROM_ADDRESS=info@voxelveda.com
MAIL_REPLY_TO=info@voxelveda.com
EMAIL_QUEUE_INTERVAL_MS=30000
EMAIL_QUEUE_BATCH_SIZE=10
TIMESHEET_APPROVAL_EMAIL_ENABLED=true
TIMESHEET_REVIEW_EMAIL_ENABLED=true
```

Use port `587` with `SMTP_SECURE=false` only when the Hostinger mailbox is configured for STARTTLS instead of implicit TLS.

Email is queued only after the database transaction commits. `email_queue` provides idempotency, retries, exponential delay, and delivery status. `email_logs` stores the recipient, subject, related record, provider message id, and failure reason. One email failure does not roll back a valid timesheet decision.

Admin email diagnostics are available under `/api/email`:

- `POST /api/email/verify`
- `POST /api/email/test`
- `GET /api/email/queue`
- `GET /api/email/logs`
- `POST /api/email/process`
- `POST /api/email/queue/:id/retry`

## Deployment

1. Back up the production database.
2. Deploy the application or apply `migrations/20260809_timesheet_workflow.sql` first.
3. Add the Hostinger variables in Railway.
4. Restart the service and confirm `/api/health` returns HTTP 200.
5. Run the email verify and test endpoints as an admin.
6. Submit a draft timesheet, request a correction, resubmit it, and approve it.
7. Confirm an immutable version, approval event, payroll row, notification, audit entry, and email log were created.

`services/workforceSchema.js` also performs additive startup migration for installations that have not run the SQL file. It never drops workforce data.

## Current scope

This release implements the production-grade timesheet approval path and server-side email infrastructure. Job-cost allocation, award interpretation, leave accrual, bulk payroll export formats, and the broader modules in the long-form platform specification should be delivered as separate tested phases rather than being represented as complete here.
