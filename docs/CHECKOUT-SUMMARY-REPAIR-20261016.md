# Checkout summary option repair

Baseline: main and live readiness `574d3075f67d7938cfae1728d161be734780091a`.

The category query selected distinct free-text values from the same employee's
previous attendance. It could never populate first-use configuration. The sheet
also reused the dashboard's open-task list (excluding done/completed tasks),
without refreshing either source. Empty data produced unexplained placeholders.

## Behaviour

- Settings → Attendance work categories → Manage work categories provides a
  persistent company list. Existing MANAGE_USERS and CHANGE_SYSTEM_SETTINGS
  step-up policy protect changes. Add, rename, activate/deactivate, optional
  current-workplace and role scope, reasons, revision checks, durable request
  identities and the existing audit chain are preserved. No business categories
  are seeded. An administrator must enter the company's actual category names.
- The exact completed session's summary-options endpoint loads active configured
  categories for first-use employees. Tasks include currently assigned open and
  completed work and retained status-audit evidence of assignment during that
  UTC shift. Cancelled/deleted, unrelated and later-created tasks are excluded
  from new selections. Existing staff VIEW_OWN_JOBS mapping was already correct;
  this repair grants no task-management permission.
- Both lists have loading, available, empty, restricted and retry states.
  Search and 50-item pages avoid silently truncating long option lists. Requests
  are scoped to the verified account, exact session and sheet instance. Old
  responses cannot populate a reopened sheet or another user's session.
- Summary saves use stable task/category IDs and the same server validation as
  the options query, preserve category/task label snapshots, require the saved
  revision and retain a request ID across uncertain retries and sheet reopening.
  Historic text-only categories remain intact. A renamed/deactivated selection
  may be retained on its original record but cannot become a new selection.
- Summary options, Skip, failures, viewing and summary retries never call clock
  actions. A summary never completes a task/job. Checkout remains committed.

## Verification and release

`checkout-summary-test.js` covers policy, first-use configuration, completed
assignments, permission restrictions, historical references and empty states.
The retained disposable MySQL suite tests actual SQL, audited configuration,
concurrent summary retries, ownership, revisions and restart persistence.
`checkout-summary-browser-test.js` reproduces baseline placeholder-only lists
and verifies the repaired application sheet, seven widths, both themes,
landscape, slow/failed responses, Retry, account change, search/pages and history.
Android instrumentation opens the actual native WebView dropdown pickers,
checks configured category/completed task text, Save/reopen and zero ordinary
external-browser intents. Browser device emulation is labelled separately.

The change is hosted code in the existing remote Capacitor application; it does
not modify production native Java, package, version or signing configuration.
The existing CI installed-APK checks are verification artifacts, not a new Play
release. Physical phones, Android Chrome and authenticated production data
require the appropriate device/account access; report evidence accurately.

Run Application Release Candidate CI, installed Android, MySQL and Security CI
on the PR, merge the exact passing source, then verify main before changing only
`.railway-release`. Observe Railway SUCCESS and exact readiness SHA. Compare
served scripts to the tested source and check unauthenticated API boundaries.
Keep the preceding deployment as the rollback target; additive tables and
historical snapshots should be retained on rollback.

Original logo/theme, live timer, private QR display/rotation, attendance
transactions, timesheets, PDF delivery and retired Banking/ERP boundaries remain
under the existing regression gates. This repair does not establish email relay
receipt or resolve the previously unavailable Play signing/Publisher bindings.
