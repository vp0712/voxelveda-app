# Automatic final timesheets and authorised source corrections

The latest instruction replaces routine Submit/Approve/Reject timesheet processing. Staff work is recorded normally; a verified completed Monday–Sunday week becomes final automatically. The production baseline inspected before editing was `5812fb116139e21f668cde7fc9aae77c1309e8c4`, Railway `198aee55-b205-488f-a0aa-60eab30c7793`, ready with weekly and procurement workers operational. Implementation, committed source, deployment and recipient receipt are separate evidence stages.

## Policy and scope

- Current company week: `IN_PROGRESS`. Completed verified positive work: `FINAL`. Unresolved attendance: `REVIEW_REQUIRED`. No worked time: no weekly message.
- No employee submission or routine manager approval is needed. The registered weekly worker finalizes the latest completed company week even before Monday's send time. Email dispatch keeps its existing Monday 07:00 Australia/Sydney default/configuration, window and bounded recovery; HTML/plain-text reports remain independent of optional PDF generation.
- Existing own/team/company visibility stays authoritative. `EDIT_TEAM_TIMESHEET` and `EDIT_ALL_TIMESHEETS` are explicit edit grants, paired with their prior `APPROVE_*` grants as scoped compatibility aliases. A team editor must still be the employee's actual manager. Self editing and ordinary own-view writes are denied. Permissions are rechecked under the employee lock.
- An edit changes the actual selected shift's start/end, recorded break and optional notes, never an unrelated weekly total. It requires a real reason and preserves originals in audit/version history. Incomplete source records can be corrected individually; other unresolved issues continue to block finalization/delivery.
- Historical approvals, inactive employee records and payroll processed/exported/locked periods stay preserved. Automatic finalization does not fabricate approval actors or create payroll records. Inactive history is labelled unverified, rather than zeroing saved hours.

## API and persistence

`POST /api/attendance/timesheets/:id/edit` requires an existing shift bound to the same employee and selected week, `expected_version`, `expected_revision`, `expected_source_minutes`, a UUID `request_id`, actual `clock_in`/`clock_out`, nullable `break_minutes`, and a correction `reason`. Nonexistent/ambiguous local times, future entries, overlaps, active breaks, planned/cancelled/unworked entries and immutable employee changes are rejected.

The edit, break supersession, source/final version, audit/activity and request receipt commit atomically. A repeated same actor/key/payload returns its durable saved result; reuse with different values fails. The additive checksummed migration `20261114_timesheet_edit_receipts` supplies a unique `(timesheet_id, request_id)` key. Request handlers assert that schema and never create it on demand.

The old routine `/submit`, `/approve`, `/reject`, `/correction`, `/amend` and `/timesheets/status` writes return `410 TIMESHEET_APPROVAL_REMOVED`. The separate attendance-correction approve/reject routes remain available because they authorise proposed evidence corrections, not routine weekly approval. Original business approvals in other modules remain unchanged.

Final source versions are stored in the existing `timesheet_versions` table with `AUTOMATIC_WEEK_FINAL_V1`, employee/week/timezone, exact verified rows/minutes, a source SHA-256 and finalization timestamp. The email and optional PDF must verify the proof against current attendance and the completed interval. `finalization_verified` is separate from `approval_verified`; system finalization never describes work as approved. Existing VARCHAR status columns support the new states without destructive schema changes.

## Delivery and revisions

Each eligible employee receives one individual complete HTML report, with a plain-text alternative, to their registered account email under the established explicit policy. There is exactly one To recipient, no CC/BCC, no manager copies and no address fallback. No-work employees are excluded. Missing addresses are visible blockers, without preventing a valid worked week becoming final.

Finalization uses employee locks, durable source versions and keyset batches. One failed employee is diagnosed without blocking others. Queue leases, claims, staff/week/revision uniqueness, current-source/recipient checks, bounded retries and uncertain-outcome review remain in place.

Frozen legacy, accepted and uncertain reports retain their original bytes/content, hashes, addresses and provider outcome. Source edits never automatically resend them. Reconciliation exposes current verified minutes separately from `snapshot_minutes`, with persistent derived `source_changed`/`revision_required` flags. A provider-accepted old version is not evidence that corrected hours were delivered. Explicit authorised revisions retain old versions and recheck prior transport outcomes; a generation retry preserves the exact old version.

The company sender and Resend configuration are unchanged. Provider acceptance is not inbox receipt. No real staff/customer reports or historical bulk backfill are used for release testing.

## Interface and verification

Staff see weekly dates, authoritative rows, recorded/final totals, source blockers, delivery information and read-only history. Routine Submit/Approve controls are removed. Authorised reviewers have View and scoped Edit icons, a source-shift form with explicit DST occurrence controls, required reason and stable request identity. Save success closes the form, shows one centred OK, refreshes current data and preserves the committed result if that refresh fails. Uncertain outcomes reconcile the saved request rather than guessing from equal hours or blindly repeating POST.

The current sidebar layout, home chart types/data/geometry, original logo, compact action icons and original operational modules remain preserved. Only timesheet-specific approval wording/actions change. Banking and the separate added ERP portal remain retired.

Regression evidence covers automatic boundary/schedule handling without a browser, source proof, no-work/planned/cancelled exclusion, missing email, own/team scope, corrections, stale versions, duplicate/concurrent requests, rollback, inactive/locked history, legacy frozen versions, controlled revisions, overnight and both DST transitions. Browser tests cover reviewer edits and foreground outcomes, readonly staff, responsive weekly views, HTML email bodies and optional PDF failures. Genuine PDF pages retain the original logo, repeated headers and page numbers.

## Release and recovery

Use the existing exact-candidate and merged-main CI gates, then a separate marker-only `.railway-release` commit. Observe Railway terminal SUCCESS, exact live SHA, source asset hashes, workers, authentication and Banking/ERP boundaries. Record final run/deployment and screenshot links in the PR handoff; local tests or an accepted message alone do not establish live/inbox success.

Keep the previous healthy deployment as recovery. Preserve the additive receipt table, FINAL/source/audit versions, queue/provider history and keys. Prefer a forward repair for compatibility failures. If restoring an older source that cannot validate new FINAL snapshots, hold affected dispatches for reconciliation; never reset statuses, delete receipts or blindly replay messages. Physical devices, private production account journeys, Play distribution, active verified DB TLS and recipient opening remain separate verification scopes.
