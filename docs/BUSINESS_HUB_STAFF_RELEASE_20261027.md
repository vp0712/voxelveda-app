# Business Hub and staff workflow release — 27 October 2026

## Scope and baseline

The source, `origin/main`, public readiness and Railway production deployment were refreshed before edits. All identified `63709fbd3c24fbe6f4c7ea1eefd6ec61e1d4c8f9`; Railway deployment `7fd5e307-cceb-4169-a11b-daaec26943e6` was successful, with no staged infrastructure changes. The weekly-timesheet and procurement-import workers were operational. This is the recovery baseline.

The reference is the actual public interface at `https://hub.voxelveda.com`, inspected independently of the operational application. This change adapts its shared visual structure inside the existing application. It does not introduce another portal, move records, change roles or resurrect the retired Banking/Finance system or separate ERP portal. The original logo must remain byte-identical.

Chart calculations, sources, chart types, orientation, category/series order, scales, units, periods, filters, tooltips and click-throughs remain part of the retained application. Before/after evidence uses the same fixture source records and filters; visual fixture evidence is not evidence of authenticated production data. The chart gate covers six charts plus supplier-category flows across seven widths and both themes, with real point/legend/accessible-table/filter interactions. All 84 corresponding canvas dimensions matched exactly, and source/aggregation hashes stayed identical. The broader retained route/role inventory remains in [PORTAL_WORKFLOW_AUDIT_20261025.md](PORTAL_WORKFLOW_AUDIT_20261025.md).

## Issue register

| Reproduction / evidence | Cause and affected surface | Repair and verification |
| --- | --- | --- |
| Historical staff weeks summed stored hours and used viewer-local dates | Staff history bypassed the authoritative attendance eligibility projection; browser timezone could change Monday/week labels | Use the shared verified projection and explicit workplace timezone; selected-week UI and PDF details are checked separately |
| Valid routine approval already accepted a blank comment; legacy status routes still fabricated reasons | Inconsistent legacy API and revision handling, rather than a single required HTML field | Preserve optional routine comment; require real reasons for adjustments, rejection, correction and approved amendments; preserve version/source-integrity guards |
| A transport-classified weekly failure could bypass `max_attempts` | Generic persistent-transport retry branch in the durable queue | Bound weekly retries and atomically recheck due time/backoff/attempt budget while claiming; retain unrelated authentication-mail policy and uncertain-outcome review holds |
| No independent staff weekly PDF when a designated email is missing | The only staff PDF link depended on a generated delivery request | Reuse an authoritative immutable source/PDF snapshot for app access independently of email eligibility. The existing private object store holds parser-validated bytes; the additive database migration holds metadata only. Never queue email merely to download |
| Changing reporting weeks while a read or submit confirmation is pending can submit the old week | Old selected timesheet remained actionable while the picker showed a new week | Clear/disable the old record on selection and recheck account, period, status and version after confirmation; delayed-response browser regression |
| Late PDF responses after logout/account switching could hand the old account's bytes to a new browser view | Shared PDF helper had no account/session boundary after asynchronous reads | Recheck the account/session after response, bytes and viewer handshake; close stale previews and revoke object URLs |
| Current weekly delivery has no recipient | Actual staff profile data, not a scheduler or approval-note requirement | Show an actionable designated-address setup state; do not substitute the login or test address |
| Existing release PDF request is validated but cannot send | WordPress HTTPS health/PDF contract preflight fails before provider dispatch | Keep safe failure state; live receiver inspection/backup/repair and controlled test remain dependent on WordPress administrator access |

## Production delivery evidence and safety

The fresh 27 October production reconciliation for the latest completed week identifies an eligible employee blocked by a missing designated address (`NO_RECIPIENT`). The timesheet is `DRAFT`, with no PDF request, queue message or provider acceptance for that employee/week. Per-employee evidence is retained in the private release artifacts, rather than publishing attendance details in source documentation. Approval is not required merely to recognise verified work, and a comment cannot supply missing attendance evidence or a missing recipient.

The established company schedule remains Monday 07:00 `Australia/Sydney`, Monday–Sunday reporting, a 120-minute dispatch window and bounded 48-hour latest-week recovery. Existing uncertain provider outcomes are held for review, not retried automatically. No historical bulk backfill or test to real staff/customer/supplier addresses is authorised by these tests.

The existing independent release fixture (document request 1, queue 157) retains one parser-valid PDF page, `application/pdf`, a recipient-visible `.pdf` filename and the matching SHA-256 `6cd80f50534ab11f89e7301435440eb34454c70e1570e7adbd4360ec929631a5`. Its status is `FAILED`, at `RELAY_PREFLIGHT_CONTRACT`, without provider acceptance or a provider message ID. Production reports `RELAY_HEALTH_JSON_NOT_READY` (HTTP 200). This establishes the current failing boundary; it does not prove the historical cause of a recipient seeing “TMP”.

The selected transport remains the existing WordPress HTTPS relay and company sender. No provider, subscription, DNS or SMTP change is made. Railway's SMTP plan restrictions do not explain invalid PDF bytes and do not require an upgrade for this existing HTTPS route.

WPVibe currently lists no registered sites for its connected account. Both canonical and www connection attempts report a non-JSON REST response. A separate public `/wp-json/` request returns a WordPress index and shows the existing relay routes, WPVibe 1.20.2 and Fluent SMTP namespace; these facts do not establish authenticated administrator access, the route-owning plugin implementation or provider configuration. A Connection Check from the signed-in WordPress administrator is still required. The prepared receiver under `deployment/wordpress` is not a claim of installation.

## Evidence limitations

Fixture PDFs, generated MIME, browser emulation, server/MySQL tests and deployed asset checks are distinct from actual signed-in production actions, physical camera/device testing, Play distribution and recipient mailbox verification. Only an authorised release fixture may be sent to the previously authorised test address. No message may be resent before its existing queue/provider outcome is reconciled. Recipient opening remains unverified until an actual received attachment is available.

Production database verified TLS and Android Play signing/distribution access remain separate outstanding integrations from the preceding release; this UI/staff work does not claim to complete them.

Local final verification passed 435 JavaScript syntax checks and all 85 regression scripts under UTC and Australia/Melbourne (production scanner/storage configuration). Fresh Chromium proofs passed the 28 chart cases, staff weekly views, approval dialogs and all 15 retained role families in weekly views. The role proof also checks contrast immediately after theme switching; foreground/background changes are kept atomic. Local WebKit launch was blocked by missing system libraries, so fresh CI installs those dependencies and runs the required WebKit gates. Real MySQL gates and exact candidate CI results remain required before release.

Candidate, CI and final deployed-commit evidence are recorded in the release marker and the external release evidence directory after the checks complete. The marker must be a separate change after the candidate and merged source pass their required gates.
