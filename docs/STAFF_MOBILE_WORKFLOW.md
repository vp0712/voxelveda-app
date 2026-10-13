# Staff attendance, notifications and profile photos

This release improves the existing application. `staff_attendance`, rosters,
tasks and `weekly_timesheets` remain the authoritative records. Banking and the
separate ERP portal remain retired. The original company logo is unchanged.

## Staff home and attendance

Home uses the workplace IANA timezone (the existing Australia/Sydney default)
and server-recorded attendance. Completed sessions contribute whole integer
worked minutes; gaps between sessions contribute no hours. Live elapsed time
is identified separately. Overnight work keeps the established whole-shift
local-start-date allocation used by weekly timesheets. Unknown or ambiguous
timestamps require review rather than invented hours.

Clock actions require an explicit action, a UUID request ID and the exact
active session for checkout/breaks. A signed workplace token is validated
before an account/action/session-bound proof is issued. Normal online actions
use the server clock. The original authorised QR-bypass grant is preserved
and audited. The default site audience is the application hostname; it is a
technical attendance site, not a claim about GPS or a roster location.
`SHIFT_QR_SITE_ID` can identify an explicitly configured workplace audience.
`SHIFT_QR_SIGNING_KEY` remains the existing production signing secret.

Action receipts and user-row transaction locks serialize concurrent requests.
Retries retain the original UUID and reconcile its receipt before attempting
another action. A repeated scan cannot toggle attendance. Recorded breaks
have retained intervals; roster breaks are not silently deducted. No location,
selfie or biometric collection is added.

Checkout is saved before the optional work-summary sheet. Notes/task selection
are a separate revision-checked, audited operation against that completed
session. They do not complete a task or change job quantities.

Staff correction requests retain original and proposed values. Missing-session
requests do not create worked time until an authorised supervisor approves.
Team authority follows the existing manager relationship and approval grants;
self-approval is denied. Approval checks concurrent changes, overlapping
intervals and locked/approved reporting periods. Historical break intervals
remain retained when an authorised correction supersedes their effect.

## Notifications and photos

The bell and Alerts control open one notification centre with a list, unread
count, close and conditional mark-all-read action. Read state is persisted per
recipient. Event identity prevents duplicate notifications. List/count/read
use the same visibility rules; opening a record rechecks current authority.
Expired, archived or unavailable targets have an explicit state. Notification
preferences are in Profile. Original invoicing/expense events using FINANCE
category names remain eligible; actual retired-system links remain blocked.

All avatars share authenticated image retrieval and revocable Blob URLs.
Photo uploads decode genuine JPG/PNG/WebP bytes, enforce byte/pixel bounds,
apply EXIF rotation and the selected square crop, then save a 512px JPEG to
configured private object storage (or the retained database storage). Saved
references/hashes and changes are audited. Legacy saved database photos remain
readable. Images are never fetched with credentials from an external URL.
Account changes clear cached images; failures expose controlled retry in
Profile. Directory photos use the original user/team/department access rules.

## Private weekly PDF delivery and verification limits

The existing scheduler, designated delivery email and durable staff/week
uniqueness remain unchanged. Only eligible actual worked attendance can queue
an individual weekly PDF. No login-email fallback, CC, BCC, manager/company
copy or zero-hour email is permitted. PDF parser/identity validation, private
queue bytes and safe uncertain-delivery handling remain mandatory.

The existing WordPress HTTPS relay failure is independent of this UI release.
Provider acceptance and received-PDF opening are separate evidence. This
release does not claim to repair an unconnected WordPress receiver or to have
tested native iOS/Android cameras. Browser fixtures use isolated synthetic
accounts; no real staff shifts or emails are created for testing. Live evidence
must identify its actual access scope and exact deployed commit.
