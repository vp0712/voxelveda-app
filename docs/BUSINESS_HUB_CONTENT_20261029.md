# Retained page content, 29 October 2026

This work starts from the released `4c01274945edcf15cf0394076602a8df4c00e884` application. The current sidebar and home/dashboard charts are excluded from redesign. No existing sidebar stylesheet, shell/navigation script, chart configuration or business calculation is changed by this content layer.

The current public Business Hub HTML/CSS was inspected again. Its content uses restrained navy surfaces, compact headings, 6–8px control/panel corners, bordered fields, grouped filters, two-column forms and sticky modal headings. Voxel Veda retains its existing light/dark tokens, original logo and readable 44px touch controls; tiny reference-site desktop text is not copied.

## Changes and boundaries

| Existing defect or gap | Repair | Preserved contract |
| --- | --- | --- |
| The former Hub layer mostly restyled the shell; internal forms and registers retained inconsistent grouping. | Separate `business-hub-content.css` styles non-home section headers, filter panels, field labels, controls, registers, page cards and account content. | Scope is `.page-section:not(#dashboardSection)` and existing `.hub-companion-content`. No body font, shared palette, sidebar rules, page gutters, canvas or chart dimensions are overridden. The existing Hub stylesheet remains last. |
| Thirty-two admin and seven staff form-grid controls relied on placeholders or unlabelled selects/dates. | Curated visible `label.form-field` wrappers associate existing RFQ, task, timesheet, supplier, compliance, competitor, company-form, settings and staff-register fields. | Original control bytes, IDs, options, input constraints, defaults, events and permission attributes remain intact. No dashboard/sidebar controls are wrapped. |
| Account security was one long panel without useful load-failure recovery or action guards. | Grouped authenticator, password and session cards; explicit read loading/error/retry; duplicate-submit protection; retained values on validation; committed sign-out remains successful if a later refresh fails. | Same own-account APIs, cookie/session authentication, MFA requirements and password constraints. HTTP outcome determines success; message wording does not. |
| A lost response could lead to repeat sensitive writes or stale account data. | Unknown write outcomes stay held; session sign-outs reconcile against known targets; read epochs and per-account pending tokens reject stale responses and stale 401 navigation. Same-account profile updates preserve entered values, while actual account changes clear private fields. | No automatic password/setup/confirmation resend, no invented recovery codes and no global session clearing. |
| MFA confirmation revokes the current session. An immediate authenticated refresh would redirect before the employee could save one-time codes. | Confirmed recovery codes stay on screen; no automatic read/redirect after confirmation; explicit Continue to sign-in. Cached account restoration checks ownership before retaining codes. | Actual response codes only. Existing managed native Back predicates protect unsaved inputs, setup and one-time codes. Pending/uncertain metadata is explicit. |
| Quality material lookup and shop-floor type/reference controls lacked visible labels. | Visible labels, named groups, useful hints and polite result announcements. | Existing IDs, validation, lookup URLs, camera controls and server gates. |
| Shop-floor record details were raw JSON. | Typed, safe DOM details and related-record tables for authorised job, machine and material responses; useful status/readiness, empty and error states. | Actual API field allowlist, source status/quantities, explicit zero versus missing, recorded dates/offsets and server-provided readiness. No arbitrary metadata/UUID dump, invented units or new business records. Operation transitions remain unchanged. |

The shop-floor controller's separate schema-column and authority defects were reported to the release owner; this content work does not claim backend scope repair from presentation changes.

## Verification

Pure checks passed locally:

```sh
node scripts/security-page-state-test.js
node scripts/shop-floor-record-view-test.js
node scripts/retained-theme-test.js
node scripts/global-brand-original-logo-test.js
```

The security fixture evaluates the actual script against deferred responses and actual page IDs. Its 20 cases cover duplicate writes, failure wording, input retention, uncertainty, safe session reconciliation, success followed by refresh failure, stale account/401 races, MFA revocation/recovery-code preservation, native dirty predicates and private value handling. The shop-floor fixture evaluates the actual helper and existing lookup integration; source records/status remain immutable and no write is issued.

The release browser command uses actual retained pages/scripts, cookie-authenticated synthetic accounts and the application CSP:

```sh
CONTENT_BASELINE_DIR=/path/to/archived-4c012749/public \
VV_BROWSER_MODULE_PATH=/path/to/playwright \
UI_PROOF_DIR=/path/to/content-proof \
node scripts/business-hub-content-browser-test.js
```

Set `VV_CONTENT_BROWSER_ENGINE=webkit` for WebKit. The gate covers 70 populated RFQ/profile/security/quality/shop-floor page × width × theme cases at 320, 360, 390, 430, 768, 1024 and 1440px; before/after screenshots use the same fixture records. It also checks visible field association, structured production data, actual security error/retry and saved outcomes, one-time-code retention, landscape and a short keyboard-like viewport.

Browser execution and screenshots are recorded by the release owner; syntax or fixture presence alone is not a browser pass. The independent current-sidebar and chart gates must pass against the preserved current-release baseline. No source/sidebar assertion is removed to accept a redesign. Physical devices, actual installed distributions, private production account actions and recipient email rendering remain separate verification requirements.
