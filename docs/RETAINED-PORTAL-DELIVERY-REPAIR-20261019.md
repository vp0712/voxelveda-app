# Retained portal and weekly delivery repairs

This change extends the existing application. No identities, role grants,
attendance, business records or prior documents are replaced. The original logo,
navy/blue themes, retirement boundaries, QR display and native shell remain.
Production reconciliation containing employee evidence is retained privately;
repository screenshots and fixtures contain synthetic identities only.

## Proven application defects

- The weekly worker saved attendance issues but dropped them from its logs.
- Once the two-hour send window ended, resolved blockers or a missed worker run
  could not be recovered automatically. Recovery is now limited to the latest
  completed week and 48 hours from its normal scheduled time (configurable 0–72).
- PDF generation retries had no durable attempt ceiling. Five attempts and a
  persistent 15-minute delay now bound routine generation; explicit authorised
  retries/revisions remain available. Source and recipient locks still apply.
- Admin review reason objects rendered as `[object Object]`.
- Unprepared delivery snapshot totals appeared as zero. They now say Not finalised; current verified work is shown separately in reconciliation. Resolved attendance issues remain in review history instead of appearing as current blockers.
- Approval service failures rendered false empty lists and zero counters.
- HR's attendance shortcut required EDIT_ATTENDANCE instead of its existing
  APPROVE_ALL_TIMESHEETS authority.
- Valid audited approval adjustments were rejected by weekly PDF approval proof
  merely because approved hours differed from source. Approval proof now also
  verifies the version's actor, reason, exact attendance, source minutes and
  approved calculation. Recorded work remains unchanged; PDFs label both figures.
- Client records silently stopped at the default first page, with no search,
  paging or retry. Failed client logout also cleared local identity prematurely.

## Portal matrix

All entries use existing authenticated routes and server permission boundaries.
No new role or separate portal is introduced.

| Existing role / route | Retained permitted work | Implemented improvements | Verification / limits |
|---|---|---|---|
| Staff `/portal/staff` | Own attendance, roster, tasks, timesheets, documents, profile | Own completed-week/delivery view; designated-address setup; readable blockers; no technical queue diagnostics; searchable permitted navigation; truthful approval loading | Own-only API tests; timer/break/resume; mobile weekly view; synthetic fixtures |
| Production `/portal/production` | Assigned jobs/stages, materials, inspection, own workforce work | Same own-week delivery/retry states and navigation; permission-scoped approval empty/failure states | Role + width/theme browser matrix; existing task/material/procurement/QMS regressions |
| HR `/portal/hr` | Workforce, roster, authorised all-staff timesheet and correction review | Repaired review shortcut; readable weekly reconciliation with related employee-ID attendance filter; authoritative approval defaults, adjustment reasons, stale-source/version protection | All-staff API authority; browser review and responsive checks; existing correction audit tests |
| Manager `/portal/manager` | Managed team tasks, attendance, approvals, procurement, customers | Team-only weekly review/search/filter/sort/pagination; exact staff filter survives related review; approval retains source hours and blocks duplicate taps | Managed-team/outsider denial; browser approval default/reason/single-write; InnoDB workflow tests |
| Supervisor `/portal/supervisor` | Managed team execution, attendance, inspection and approvals | Same scoped weekly review and controlled error/retry states; permitted navigation search | Team boundaries and responsive fixture checks |
| Sales `/portal/sales` | Authorised RFQs, customers, meetings and approval requests | Permitted-page search; approval outages show Unavailable and Retry with unknown counts | Workforce reconciliation denied by default; retained RFQ/customer workflows and browser state |
| Admin `/admin` | Existing operations, people/access, configuration, audit | Full reconciliation including missing deliveries and PDF/queue history; readable reason objects and exact attendance references; designated-email repair action; generation retry/versioned correction retain existing authority | API/query scopes, read-only Close, responsive layouts, real InnoDB source/queue/audit tests |
| Super Admin `/admin` | Existing broader authorised administrative/security functions | Same operational reconciliation improvements, without exposing credentials | Same fixture matrix plus existing security/permission regressions |
| `finance_admin`, `finance_user`, `accountant` `/admin` | Existing permission-limited invoice/expense/supplier/procurement/approval work | Shared approval loading/failure/retry and truthful counts; existing commercial functions preserved | Each role tested; workforce reconciliation denied unless explicitly granted. These are existing role templates, not restoration of the retired Banking/Finance system |
| `viewer`, `view_only`, `client`, `customer` `/client` | Their own explicitly authorised enquiries, invoices/documents and profile | Server-backed record search/pagination, genuine empty/error/retry; account response isolation; PDF action through validated existing viewer; duplicate-click guard and truthful failed logout | Each role tested with populated fixtures, search and paging; cross-user data isolation remains enforced in existing RFQ/invoice APIs |

## Delivery and privacy

The leased worker re-evaluates actual attendance; no review flags are bypassed.
The unique employee/week delivery, frozen source, unique queue key, generation
claim and final locked source/recipient check remain authoritative. Accepted and
uncertain messages are never automatically resent. Recovery queues one original
version where eligible; explicit corrections preserve prior versions and audit.
No older week is automatically backfilled.

Reconciliation separates eligibility, missing designated email, PDF generation,
queue/retry/failure, provider acceptance and unverified receipt. It also checks
previous queues and unlinked document generation attempts. Normal staff receive
only their own safe presentation; authorised reviewers get the affected records.
Exactly one validated designated To address is required, with no copies or login
email fallback. Empty, open and unresolved work cannot become emailed work.

The configured transport is unchanged. Its health errors now include a safe HTTP
status/reason rather than an undifferentiated code. Receiver authentication or
PDF/privacy contract failures remain blocking. No provider switch or purchase was
made. Provider acceptance is not recipient verification.

## Verification

- `npm run build`: 77 retained application regression scripts, including a new
  read-only reconciliation test. Production enforcement and packaged-source
  variants run in the existing release CI.
- Weekly eligibility/recovery regression covers latest-week bounds, disabled
  recovery, delay/attempt ceiling, concurrent workers, restart, source changes,
  accepted/uncertain outcomes, designated recipients and audited adjustments.
- `scripts/retained-mysql-test.js` additionally verifies real InnoDB missed-window
  recovery after a fixture address correction, one concurrent queue, persisted
  generation count, one recovery audit, and separate PDF/provider/receipt states.
- `scripts/weekly-portals-browser-test.js`: before/after false-empty reproduction;
  15 retained role names; 98 weekly-view width/theme cases at 320, 360, 390, 430,
  768, 1024 and 1440; landscape; reachable short-viewport approval actions;
  authoritative defaults, adjustment reason and single-submit; readable blockers,
  one read-only Close, actual authorised entry buttons, permission denial, search/filter/paging and controlled retry. Mobile filters collapse behind a labelled control; computed filter-action contrast is checked in both themes.
- Existing live-clock browser regression confirms visible ticking, recorded break
  pause/resume, other-device checkout, refresh and resume without extra punches.
- Real parser and decoded MIME regressions preserve .pdf filenames,
  application/pdf, exact individual bytes, employee/period/rows/totals, invalid
  HTML rejection, unchanged original logo and separate authorised approved hours.
- Real-device employee inbox receipt and the affected installed phone/Play build
  require their actual access. Emulator verification is reported separately and
  must not be described as a production Android release.

## Recovery and rollback

Resolve attendance using the existing audited correction workflow and real local
start/finish/break evidence; save a validated designated delivery email through
Profile or authorised staff settings. Recovery can then re-evaluate the completed
week. After the bounded window, use the existing authorised versioned correction
or failed-generation retry; reconcile all prior queue/provider outcomes first.

The initial read-only diagnostic release is ed2df50bb06a4d98fd6e7e27e38f89cbe6c7a51a,
Railway ab2b6b08-c605-45cd-9023-71abe89f5404. It changes no delivery policy. It can
serve as a rollback target for this repair. New generation metadata is additive;
do not delete historical snapshots, categories, attendance or audit on rollback.
