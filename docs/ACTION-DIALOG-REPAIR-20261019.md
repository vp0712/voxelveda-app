# Action feedback and responsive workflow repair

The inspected source and live baseline was 5d3249f49cfbde5090b4f228e7ea21990f730f6a.
This repair extends the retained application and existing API permissions; it does
not replace portals, role templates, business records, the original logo or themes.

## Confirmed defects and corrections

1. Admin and staff inferred success from message words. The HTTP409 text
   “Attendance source records require authorised correction before this timesheet
   can be submitted or approved.” matched success, although the transaction rolled
   back and the record stayed pending. Message classifiers and the timed green
   popup are removed. Callers now declare error/success/info outcomes from their
   request/control flow; arbitrary wording cannot choose the outcome.
2. Approval displayed feedback before checking HTTP status, without checking its
   returned record. The shared action runner verifies record ID, committed status,
   approved hours and version. Duplicate taps share one action; existing locked
   server version/status checks prevent duplicate approval/audit/payroll transitions.
3. A dropped connection can produce an uncertain outcome or a repeated transport
   request returning a version conflict after the first commit. The runner reads
   the authorised current record before retrying. Accepted state is preserved;
   refresh failure is a separate warning, not another approval attempt.
4. Caught dialog errors went to a background toast. Shared centred feedback now
   suspends its origin through the overlay manager, traps foreground focus and
   restores the form. Success closes the completed approval form and has one OK.
   Errors preserve values. Validation consolidates required/invalid fields, marks
   them inline and returns focus. Pending writes cannot be dismissed. Unknown
   generic write outcomes require reconciliation rather than automatic retry.
5. Native confirmation prompts were used by retained action workflows. They now
   use managed confirmations/reason input. Security verification participates in
   the same modal stack. Android Back closes the foreground layer only.
6. Mobile generated labels plus separate name/email nodes occupied different grid
   cells. A legacy .table-wrap table minimum of 760px also beat the weaker
   .responsive-table width rule inside the scroll region. The shared table selector
   now enforces its intended zero minimum; a containment regression proves the
   760px failure before the fix. A single value group preserves label association. Status chips and
   action groups can shrink/wrap; periods use readable calendar dates. CI also reproduced a stale portrait viewport value during landscape opening;
   dialogs/feedback now synchronise current viewport bounds on opening, before
   delayed resize events. Dialogs follow visual viewport offsets/heights and safe areas; footer actions stay out
   of the scrollable content. No global horizontal-overflow hiding is used.
7. Admin button normalisation converted implicit form submit controls into inert
   ordinary buttons. It now preserves form semantics; a real submit-event regression
   verifies consolidated validation instead of a silent no-op.
8. A missing attendance edit ID could open the add-entry form. It now reports an
   unavailable record and requires a register refresh, preserving record identity.

## Attendance source integrity

Source-review flags disable approval. The review form displays current verified
completed hours, specific issue identities, related attendance and a source reload
following a legitimate correction. Entering adjusted hours/reasons cannot bypass
server review. Rejection and correction also carry the reviewed record version.
Saved flags may belong to closed sessions; the explanation no longer falsely
states every flagged record lacks checkout. Original attendance is preserved.

## Retained portal/workflow matrix

| Existing roles / route | Shared repair and retained authorised work | Verification |
|---|---|---|
| Admin, Super Admin /admin | Timesheet register/detail/approval/reject/correction/amendment; create/edit/archive/restore in original commercial, workforce, inventory, procurement and settings; scoped PDF/queue outcomes | Exact409/no commit; successful persisted approval, audit rollback/concurrency; populated registers; responsive and security verification |
| Staff /portal/staff | Own timesheets, tasks, attendance and optional summary; create/edit validation and error ownership; own-only APIs retained | Timers, checkout choices, private weekly delivery and original staff browser suite; new foreground/account-switch cases |
| HR /portal/hr | Existing all-staff review/correction and versioned approval; shared forms/navigation | Role matrix, scoped API/MySQL tests, source blockers and foreground validation |
| Manager /portal/manager | Team review and approvals, assigned operational work and permitted procurement | Team/outsider denial, authoritative source/reason/version, one-write and weekly browser tests |
| Supervisor /portal/supervisor | Team execution, authorised review and original operations | Same scoped role/responsive/shared-dialog checks |
| Production /portal/production | Assigned jobs, stages/materials/inspection and own workforce functions | Role matrix and retained production/QMS/procurement regressions |
| Sales /portal/sales | Existing RFQ/customer/workflow request functions | Shared action validation/error/retry, denied workforce approval, retained RFQ persistence tests |
| Existing finance_admin, finance_user, accountant /admin | Permission-limited original invoice/expense/supplier/procurement workflows | Each role's shared form/layout and approval denial; invoice payment/PDF and expense idempotency regressions retained; no retired Banking system restored |
| Existing viewer, view_only, client, customer /client | Their authorised records/documents/profile | Each actual portal document, foreground errors and denied approval; existing client search/pagination/isolation regressions |

The caller audit covered action/dialog/notification/native-prompt calls across
14 existing browser modules. 367 legacy calls were migrated or explicitly classified; the remaining callers already use dedicated components or
read-only/local status handling. This inventory is not a claim that all possible
business paths are bug-free. Background notifications remain unobtrusive.

## Verification and limits

- Exact baseline false-success reproduction with unchanged pending fixture record.
- HTTP409 words submitted/approved; other errors containing saved/ready/submitted.
- Valid approval closes its form, centred context/approved hours, one OK, persistent
  state in a fresh authenticated session; double taps commit one transition.
- Required fields, inline errors/focus, retained values, unsaved Cancel, pending
  dismissal lock, malformed response, source/version conflict, dropped response,
  committed write followed by refresh failure and late account-switch responses.
- New browser matrix: 15 real role names, 210 width/theme cases per engine at
  320/360/390/430/768/1024/1440; portrait/landscape, enlarged text and short viewport.
  Chromium locally; WebKit and installed Android verification run in release CI.
- Real MySQL regression snapshots the exact HTTP409 request and asserts unchanged
  timesheet/version/approval/payroll/email rows. Existing concurrency/audit rollback,
  invoice/payment, procurement, PDF/MIME, QR, privacy and security gates remain.
- Native instrumentation adds foreground validation/error, preserved input, one
  Back layer, managed discard and scroll cleanup to existing installed journeys.
  Native production source/configuration/signing identity is unchanged.
- Fixture screenshots contain synthetic identities only. WebKit is not a physical
  iPhone/Safari/PWA test; installed Android emulator is not the user's Play build.
- Production source review requires actual attendance evidence and authorised
  corrections. No real invoice, attendance or approval is altered for testing.
  Screenshot-specific employee/period cannot be inferred from an error message.

Release evidence must separately record candidate/main CI, Railway SUCCESS,
actual live readiness SHA and source-matching uncached assets. The previous release
is the rollback target; preserve all records/audit and additive metadata.
