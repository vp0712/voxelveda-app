# Weekly HTML timesheets and retained portals, 28 October 2026

## Source and scope

This candidate starts from main/live `50e9b5933a78693312257193134b57c3d39dc6fd`, after PR #334's shared Business Hub shell. It preserves that release's original logo, dashboard chart functions, aggregation, permissions and retained operations. Banking/Finance OS and the separate added ERP stay retired. No historical attendance, recipient, source file, document or audit record is rewritten.

The updated user requirement allows the complete weekly timesheet inside the email body. PDF is optional for this workflow only. Invoices, quotations and other document attachments retain their PDF-only parser, identity, bytes and filename controls.

## Issue register

| Reproduction / cause | Change | Verification / limitation |
| --- | --- | --- |
| Weekly preparation required a PDF document request and PDF relay contract even when the employee only needed the report. | Explicit HTML format; complete branded HTML and text alternatives; immutable source/content/hash/layout version; zero attachments; independent HTML relay contract. | Renderer, queue, transport, eligibility, API, browser and real-MySQL gates. Live receiver installation and inbox receipt remain separate. |
| Optional app PDF may have been frozen before the HTML report's issue timestamp. | Compare the exact business source/version when accessing the optional PDF, preserving its original validated bytes and timestamp. Legacy PDF deliveries retain strict document-snapshot matching. | Earlier-PDF/later-HTML and changed-source regression cases. |
| Retry could unnecessarily rerender a previously frozen HTML report. | Reuse validated stored content/hash after locking; render only a new immutable content version. | Retry fixture deliberately makes the current renderer fail and verifies the exact frozen body is queued. |
| A relay's `sent:true` alone did not explicitly prove its declared acceptance result. | HTML success requires explicit provider acceptance and exact request/content/recipient contract. Missing or conflicting acceptance evidence is held for review. | Missing/false acceptance and uncertain retry tests; no automatic duplicate resend. |
| Recruitment register capped results at 500; visible-page counts appeared to be selection totals. | Permission-scoped validated server search/filter/sort/page; consistent full-selection count/metrics and page snapshot. | 650-row MySQL fixture, concurrent count/page checks, literal search and pagination tests. |
| Recruitment table needed horizontal scrolling on phones; inactive status overlay intercepted controls. | Scoped labelled mobile cards, accessible controls, actual loading/error/retry and pagination, hidden inactive managed dialog. Saved status persists independently of a later refresh error. | Fourteen populated width/theme browser cases and managed status interactions. No chart grid or canvas selectors changed. |
| Delivery UI described a missing PDF as an email blocker. | Report format, rendering/queue/transport/provider/receipt and optional PDF statuses shown separately; own app PDF actions remain available without a recipient. | Existing multi-role weekly portal browser gate expanded for HTML readiness and optional-PDF HTTP failure. |

## Delivery model

The existing worker remains Monday 07:00 Australia/Sydney, using the most recently completed Monday–Sunday period. Source attendance must contain eligible actual worked time. Planned/no-work/ineligible staff receive no message. Incomplete, overlapping or invalid source attendance remains review-required. A valid designated timesheet address is mandatory; login addresses are never substituted. Every layer enforces one To, no CC/BCC/default copies, correct staff/week/revision and current eligibility.

The additive checksummed migration `20261028_weekly_timesheet_html` adds delivery format and frozen content/hash to current and version records. Existing frozen PDF reports remain PDF. Untouched legacy placeholders can prepare HTML; accepted reports are never rewritten. Corrected reports require an authorised new revision. Claims, leases, atomic queue links, bounded retry/recovery and uncertain-outcome holds remain in place. No historical bulk backfill is initiated.

HTML contains actual employee identity, reporting period/timezone, issue date/version, shift start/end/break/work/site rows, daily totals, recorded decimal and hours/minutes totals, separate verified approved hours and actual review status. Missing breaks/sites remain “Not recorded.” Original logo bytes are unchanged; blocked images leave complete readable company and report text. The body uses email-compatible inline styles with labelled stacked rows on phones. PDF pagination/A4 whitespace is not carried into email.

## External production evidence at candidate preparation

Production Railway deployment `334dbd3d-bdd6-4a97-8951-9e49f3ca67bc` was SUCCESS at source `50e9b593`. Rollback retains that deployment and additive schema/history.

The last completed 19–25 October cohort contained 19 accounts: 15 no-work, three ineligible accounts and one otherwise eligible employee without a saved designated address. That report cannot be redirected or treated as delivered. Its bounded historical recovery window has ended, so an authorised controlled recovery is required after the genuine address is saved and previous outcomes are reconciled.

The configured transport remains the WordPress HTTPS relay with company sender `info@voxelveda.com`. Existing PDF verification request 1 / queue 157 failed the relay's JSON contract before provider acceptance; no provider ID or receipt exists. The new HTML format does not fix non-JSON connectivity. WPVibe still listed no connected site. Prepared receiver v4 and fixture tests do not prove installation. Required access is a secure authorised WordPress administrator or hosting/plugin connection that can inspect and back up the actual route owner, receiver source, mail hooks and related logs before installation. Do not paste credentials in chat.

The supplied WordPress report shows working pretty `/wp-json/` paths and failed root `?rest_route=` variants. This does not identify a firewall rule or prove an IP block. No firewall, DNS, provider, plan or billing changes are made. The authorised fixture inbox is retained from the session; real employee reports must not be used as tests. Provider acceptance and actual inbox body rendering are separate evidence and remain unverified until observed.

Active application database TLS and Android distribution remain separate integration gaps. At preparation, live TLS verification was false and Android assetlinks returned 503; no verified Play signing/publishing binding or physical-device release evidence was available. CI TLS/emulator fixtures do not prove those production outcomes.

## Release evidence

Run the 88-script regression suite and syntax checks, UTC and production Melbourne builds, real MySQL fresh/upgrade/concurrency/TLS fixtures, Chromium/WebKit staff/approval/portal/document/import gates, PHP normal and parser-absent HTML receiver fixtures, chart preservation and installed Android verification. Preserve per-SHA workflow artifacts. The existing chart gate compares the approved baseline at 28 cases and 84 matching canvas dimensions; local evidence additionally compares this candidate with the current live source.

Screenshots and local fixture MIME are evidence of rendering and contract correctness, not an actual received email. Physical phones, private production-account actions and actual hidden-browser-tab restoration must be reported separately from browser emulation.

Merge only the final passing candidate; verify merged-main gates; then use a separate marker-only `.railway-release` commit. Observe terminal Railway SUCCESS and verify live SHA, asset bytes, unchanged logo, retained/retired boundaries, background workers and additive migration. A successful deploy does not establish email delivery.
