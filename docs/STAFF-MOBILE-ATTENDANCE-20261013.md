# Staff home and attendance

The existing staff dashboard now opens on a compact home with the unchanged company logo and shared navy light/dark theme. Home, My shifts, My timesheets, Tasks and Profile use the original dashboard sections. Other original functions remain in the existing permission-gated navigation. Shared authenticated avatars and the notification center use the same account and overlay components as the retained application.

Home reads `/api/attendance/today`. Workplace date/greeting use the configured company IANA timezone and server time. Worked minutes consolidate the authoritative completed and eligible live sessions; first/last timestamps are labels, never a span used to calculate hours. Overnight sessions retain their original local-start reporting allocation. The active overnight duration and allocation date are shown separately. Recorded zero breaks, absent break records and partial break records remain distinct. Planned roster breaks are not deducted automatically.

The staff member sees only their own shifts, assigned tasks and attendance. Task/roster cards follow the endpoint's original permissions. Actual team/department and notification counts come from authorised server records. Loading and failure states do not fill dashboards with guessed values.

Canonical `/auth/me` verification precedes new home/history data. Auth/storage/avatar boundary events immediately clear private names, attendance, sheets and camera state, abort owned requests and invalidate their account epochs. Late responses and mutation finalizers cannot republish an earlier account, including transports that finish despite cancellation. `/today.profile.id`, own history rows and mutation receipts must match the verified account. Shared avatar auth headers support both cookie sessions and retained bearer compatibility. A same-account avatar cache clear retains an unresolved request identity until canonical verification proves its owner; a different account cannot reuse it. Admins return to `/admin`, while client/viewer role changes clear the staff shell and use the established dashboard router.

The visible weekly-hours read is guarded separately from legacy timesheet counters. Its failure shows an unavailable weekly value while valid daily check-in/out remains usable; it does not fabricate zero hours or block checkout because a secondary summary failed.

## Attendance actions

The camera scans the existing workplace QR. `/qr/validate` checks it for an explicitly chosen check-in or check-out, and returns a short-lived proof bound to the signed-in staff member, attendance site and exact session. Scanning alone never records an action. The confirmation identifies the signed-in staff member and verified attendance-site reference, with explicit confirmation before `/actions` is called. Camera denial, missing camera/decoder, invalid QR, expiry, wrong site and changed session show actionable failure states.

Every action carries a stable UUID. Pending identity is retained in session storage for that signed-in staff member; QR proof and notes are not stored there. A lost response goes to `/reconcile` before another action. A controlled retry reuses the original UUID and exact session, with a fresh verified proof when needed. Repeated scans do not toggle attendance or change a different session. Server timestamps remain authoritative.

Break start/end use the same explicit session and idempotency checks. Check-out closes the original session first. The optional task/category summary is a separate revision-checked write to that completed session; Save failure or Skip does not undo check-out. Uncertain summary retry retains its exact UUID and payload rather than resending changed data.

## History and review

Own history is paginated and date-filtered through `/my`. Team/all views query `/sessions` only within existing explicit viewing authority, actual manager assignments and returned staff identities. Staff/department search, session status/date filters and counts come from the server. Correction review additionally requires approval authority and `can_review`; read-only team viewers are not granted decision access.

Existing-session corrections preserve the original attendance ID and revision. A missing-shift request carries `MISSING_SESSION` without creating worked attendance. Both are proposals pending authorised review. Approval/rejection applies to the exact retained proposal, requires a reason and checks authority and revisions. Incomplete or ambiguous times require review rather than becoming completed work. Local datetime fields use the company's verified timezone; the server checks daylight-saving ambiguity. Request retries retain their UUID and payload after an uncertain response.

Action and checkout-note writes respect approved and payroll-locked periods. Replaying an already committed receipt remains safe. Authorised time corrections retain historical break intervals and mark them superseded with the correction actor and attendance revision; superseded intervals cannot override the corrected break amount. Long-open-shift detection on read never changes attendance, review flags or revisions.

Daily, current-week and timesheet review totals share the existing weekly PDF eligibility policy: completed, verified, non-overlapping source minutes consolidate before conversion to hours. Duplicate, rejected, cancelled and unverified rows remain preserved, with saved historical totals and review diagnostics reported separately. Submission and approval stop when source review is unresolved. Newly created versions contain the exact eligible attendance used by weekly approval proof, alongside separately retained raw source rows and diagnostics. Already approved historical totals and version snapshots remain unchanged; authorised approved-hour overrides retain their original separate approval and audit workflow. Own-roster visibility preserves the original composite `VIEW_ATTENDANCE`/`EDIT_ATTENDANCE` policy and never grants access to another staff member's roster.

The shared overlay manager keeps menu, profile, scanner, note, history and notification surfaces exclusive, restores body scrolling and returns focus. Scanner close/navigation stops its camera tracks. Layout includes safe-area padding, touch targets, phone bottom sheets and a landscape camera size.

## Verification scope

The new staff JavaScript passed `node --check`, and markup checks confirmed unique IDs, the original logo reference and shared bell/avatar hooks. Browser, database, camera-device and production checks belong to the release workflow; syntax checks alone do not establish operational attendance or a deployed release. No real attendance, messages or staff emails were created by these local checks. Original document/PDF and private weekly-timesheet delivery logic is unchanged by this interface work.
