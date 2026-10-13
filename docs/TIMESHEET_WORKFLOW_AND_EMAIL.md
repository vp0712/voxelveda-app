# Timesheet workflow and targeted weekly PDF delivery

This document describes the restored implementation and its regression fixtures. Deployment, provider acceptance and recipient opening require separate release evidence. The account-only release at `7c556ddf69b43b5ba119a08d04156a052a3859c7` did not register this weekly job.

The retained review lifecycle remains DRAFT → PENDING_APPROVAL → APPROVED, or CORRECTION_REQUIRED → CORRECTION_RESUBMITTED. Rejections require a reason; approved amendments retain versions and audit history. Weekly delivery does not require payroll approval, approve a timesheet, invent pay rates, calculate payroll amounts or change a saved review decision. A PDF is marked Approved only when the saved approving actor, approval version, totals and complete attendance snapshot match the actual worked records. Otherwise its review status is provisional; a stale approval is labelled CORRECTION_REQUIRED.

## Actual-work eligibility

The weekly job selects employee IDs from authoritative attendance for the most recently completed company-calendar Monday–Sunday week. It never creates its mailing list from active users, permissions, planned rosters or dashboard estimates. Customer/client/supplier/viewer accounts are excluded. A manager or administrator who personally worked can receive only their own qualifying timesheet; their role never creates a copy of another employee's PDF.

Automatic delivery requires completed start/end evidence, positive saved work minutes, saved hours agreeing with those minutes, and elapsed time agreeing with recorded work and breaks. Manual worked time additionally requires explicit authorisation by an actor with attendance-editing authority and its recorded timestamp. The original manual attendance form now records source, breaks when supplied, UTC timestamp basis, company timezone and authorisation, with old/new values in audit history. It converts company-local input to UTC; nonexistent daylight-saving times are rejected and ambiguous times require an explicit offset. Missing clock-out remains incomplete with zero completed hours and review required.

Deleted, rejected, cancelled, planned and zero-work entries do not contribute. Exact duplicates contribute once. Overlap, ambiguous multiple duration-only manual entries, missing clock-out, inconsistent work/break values, mixed employee identity, unverified timestamps or legacy automatic twelve-hour closure evidence blocks that employee's automatic generation with an actionable diagnostic. Reading attendance now marks old open shifts for review; it never fabricates a clock-out or twelve completed hours. Historical rows, notes and IDs remain preserved.

Whole completed shifts belong to their local clock-in day. A Sunday shift finishing Monday belongs wholly to the completed Sunday week; a Monday-local shift belongs to the new week even when its UTC date is Sunday. This preserves the original whole attendance-row/day convention instead of introducing split payroll allocation. UTC elapsed minutes handle overnight work and daylight saving, and completed Sydney calendar weeks can contain 167 or 169 real hours. The reporting interval and allocation rule appear on the PDF. New UTC records consolidate integer worked minutes before rounding the weekly total, so twelve 50-minute shifts total 10.00 hours rather than 9.96 from rounded shift decimals. Inconsistent source minutes/hours are blocked for review; legacy approved totals stay unchanged until an authorised correction.

## Schedule and truthful timestamp handling

The default is Monday 07:00 Australia/Sydney, with a bounded 120-minute enqueue window. The established 07:00 send hour is retained; the previous unrestricted after-07:00 catch-up behaviour is replaced with an explicit weekly window. Company deployment settings expose the send day/time:

```text
WEEKLY_TIMESHEET_EMAIL_ENABLED=true
TIMESHEET_TIMEZONE=Australia/Sydney
WEEKLY_TIMESHEET_EMAIL_TIMEZONE=Australia/Sydney
WEEKLY_TIMESHEET_EMAIL_WEEKDAY=1
WEEKLY_TIMESHEET_EMAIL_HOUR=7
WEEKLY_TIMESHEET_EMAIL_MINUTE=0
WEEKLY_TIMESHEET_EMAIL_WINDOW_MINUTES=120
WEEKLY_TIMESHEET_EMAIL_INTERVAL_MS=900000
```

Weekday uses ISO numbering: 1 Monday through 7 Sunday. The window must finish on its configured day. Only valid Australian IANA zones are accepted. If both timezone settings exist they must agree; the company timesheet timezone is authoritative. The schedule getter and API expose the resolved zone, day/time, next local/UTC due time and waiting reason. This job is separate from any Sunday project-status reminder.

Every cycle considers one most recently completed week. Startup outside the configured window queues nothing. Missed weeks are not automatically replayed; `force` cannot bypass the window. An old pending routine version is held when its period ceases to be the most recently completed week. An initial diagnostic with no frozen source or queue can be reassessed within the window when actual evidence changes, for example a Sunday overnight shift clocking out after 07:00 Monday. This never supplies a missing clock-out; frozen or queued versions remain held for controlled correction.

New clock events use `UTC_TIMESTAMP()` and explicit per-row `timestamp_basis='UTC'` / `recorded_timezone` metadata; new authorised manual corrections use validated UTC values. These proven rows can operate without making claims about historical storage. Legacy unzoned DATETIME rows with NULL timestamp metadata remain REVIEW_REQUIRED. A conservative query margin admits legacy candidates for review without assigning guessed UTC hours. Clocking out an old unverified open shift records only the actual UTC end, with a separate `clock_out_timestamp_basis`, leaves the old start and saved amounts intact, and reports pending review; no guessed duration is calculated. An authorised attendance correction can explicitly establish actual UTC values while retaining the previous values in its audit entry.

`ATTENDANCE_STORAGE_TIMEZONE=UTC` is optional and may only be set after verifying the historical database/session settings and timestamp provenance. Current `@@time_zone` alone does not prove historical values. Leave it unset when that history is unverified; the schedule then reports `timestamp_policy=EXPLICIT_ROW_UTC_ONLY`. Schema preparation is additive and does not backfill timestamps, manufacture hours or erase records.

The actual application startup registers `weekly_timesheet_email` with the shared distributed background-job lease. Durable generation claims and unique `(user_id, period_start, period_end)` storage independently protect multiple replicas, direct concurrent runs and restarts. The job logs staff ID, period, status, version and source hash, without addresses, credentials or PDF contents.

## One designated recipient and one validated PDF

The sole recipient source is the explicit nullable `users.timesheet_delivery_email`, controlled in the original staff/profile workflows and audited. Existing accounts are not backfilled from login email. Missing or invalid designation produces NO_RECIPIENT and no email. No guessed, administrator, company, payroll, distribution-list or login recipient is used as a fallback.

Weekly messages have exactly one To, no CC and no BCC. The job payload, durable `email_queue.delivery_policy_json` and final transport enforce the same immutable staff/period/version/hash/recipient policy. Shared helpers cannot add default recipients. Before queueing, and again immediately before transport, transactions lock and recheck the employee, active account, designated address, worked records, review state and canonical hash. Termination, archived work, source changes, changed addresses, additional recipients, unregistered legacy queue rows or invalid bytes block delivery for review. A completed version's recipient is never rewritten.

The canonical single-employee snapshot renders a restrained PDF with the original logo, verified company details, staff reference, reporting week/timezone, starts/ends, recorded breaks, worked hours, available job/site references, daily/weekly totals, review status, pagination and preserved actual generation time/version. It includes no other employee or fabricated pay figure. The same queued validated bytes supply document preview/download and attachment; regenerated alternate versions are not silently substituted.

`queueDocumentEmail` generates actual PDF bytes, parses all pages and checks document identity/content before queueing a single safe `.pdf` attachment with `application/pdf` and attachment disposition. Queue and relay round trips retain those bytes and metadata. Generation failure retains an actionable request and produces no fallback attachment or misleading success email. Document generation, queue status, provider acceptance, failure/retry and recipient verification are separate states. Queue SENT denotes provider acceptance, not delivery, opening or reading.

## Controlled corrections and retries

Queued or accepted staff-periods are never automatically recreated or resent. An authorised correction explicitly increments the same staff-period version, preserves earlier snapshot/queue/PDF/history, records the actor and reason, renders current authorised records and labels the document/email as a revision. A changed pending source cannot be rewritten into its existing version. An uncertain prior provider outcome requires explicit acknowledgement before a correction; SENDING remains blocked until its outcome is resolved.

An unchanged generation failure may retry within the current window using the same immutable source/version. The controlled retry endpoint also supports that exact generation retry without inventing a new version. A queued transport retry still rechecks privacy and eligibility. Uncertain provider acceptance enters REVIEW_REQUIRED rather than blind automatic resend. Legacy queued weekly rows are retained and held for review.

Authenticated endpoints:

- `GET /api/attendance/timesheets/weekly-deliveries` provides authorised staff/team/all filters, bounded pagination, delivery diagnostics and resolved schedule.
- `GET /api/attendance/timesheets/weekly-deliveries/:id` provides scoped detail and version history.
- `POST /api/attendance/timesheets/weekly-deliveries/:id/revision` accepts `expected_version`, a required `reason`, and where necessary `confirm_possible_previous_delivery=true`.
- `POST /api/attendance/timesheets/weekly-deliveries/:id/retry-generation` retries an unchanged unqueued GENERATION_FAILED version.

Sending requires SEND_COMPANY_EMAIL plus employee-specific review authority, or company-mail management with all-timesheet visibility. List/detail access follows original own/team/all timesheet permissions. The old `/timesheets/send` endpoint delegates to this controlled workflow; recipient overrides, copies and its previous all-staff/admin-copy behaviour are rejected. Authorised general report downloads remain separate from sending an individual weekly PDF.

## Sender, transport and verification

Use the authorised sender `info@voxelveda.com` through the existing verified transport. Railway SMTP restrictions affect connectivity, not attachment formatting. A plan/provider decision does not repair PDF defects, and no billing/provider change is implicit in this feature.

Run `node scripts/weekly-timesheet-eligibility-test.js`, `node scripts/weekly-timesheet-api-test.js` `node scripts/staff-expense-workflow-test.js` and `node scripts/timesheet-workflow-regression-test.js`. Fixtures prove worked A/no-work B/planned C; missing/invalid and changed designated recipients; incomplete/manual/break review; duplicate/overlap exclusion; employee-only content; overnight and week boundaries; both daylight-saving directions; rejected nonexistent/ambiguous manual times; bounded configurable scheduling; concurrent/restarted claims; atomic queueing; PDF failure; account termination and removed attendance before transport; immutable policy checks; exact saved approval proof; and explicit revision/history with no automatic resend.

Fixtures never send real staff messages or replay historical weeks. PDF rendering/MIME evidence and live worker/deployment evidence are recorded separately. Provider acceptance must not be reported as recipient opening; mailbox access or confirmation is needed for that last step.
