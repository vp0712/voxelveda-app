# Resend, registered-email timesheets and report email — 12 November 2026

## Scope and refreshed baseline

This release continues the existing Voxel Veda application. The user explicitly authorised Resend and selected staff registered/login addresses for routine weekly delivery. The current sidebar, home/dashboard chart renderers and calculations, unchanged original logo, operational records, security and role boundaries are preserved. Banking/Finance and the separate added ERP portal remain retired; original invoicing, procurement and other retained operations remain supported.

At preparation, main was `f3fd5e8ff188978e4089978ca0897bf2a8332eb7` and live readiness initially identified `ba7b6790849c02b50b3f51a8db5e12483f03b9aa`. After the service's key configuration changed, a fresh Railway read identified successful deployment `794432b5-2863-4b20-879a-7c3202daaa64`; live readiness then matched main `f3fd5e8ff188978e4089978ca0897bf2a8332eb7`. `RESEND_API_KEY` is present; OAuth exposed its name only. Presence does not establish a valid credential, verified sender, selected transport or successful send.

These are preparation observations, not a claim that this candidate is deployed. Final source, CI, release marker, Railway result and live asset evidence must be recorded after verification.

## Secure Resend setup

1. In Resend, open **API Keys → Create API Key**. Use a recognisable production name and **Sending access** for the already verified domain covering `info@voxelveda.com`. Do not create a different company sender or change DNS unless separately authorised.
2. In the existing Railway `voxelveda-app` service and production environment, open **Variables → New Variable**. Save the key as `RESEND_API_KEY`; use the platform's protected or sealed-secret handling where available. Never paste its value into chat, logs, an issue, a screenshot or source code. An existing sealed key must not be recreated merely because its value cannot be read.
3. Keep `MAIL_FROM_ADDRESS=info@voxelveda.com`, the existing company display name and authorised reply-to. After the tested application source is ready, explicitly select `EMAIL_PRIMARY_TRANSPORT=resend` and `PDF_EMAIL_TRANSPORT=resend` through the permitted release workflow. Merely adding the key does not select a provider.
4. Verify active transport configuration and send only controlled synthetic release fixtures to the inbox explicitly authorised in the session. Record the provider's result separately from inbox observation. Never use a real employee's report, a customer invoice or a supplier address as a transport fixture.

Resend uses HTTPS, so direct outbound SMTP restrictions are not a reason to upgrade Railway for this transport. No plan purchase, provider substitution, subscription change or DNS change is part of this setup. The existing account's plan, quota and usage charges remain governed by Resend; this release makes no unverified cost estimate or automatic billing change.

A restricted sending key may be unable to list domains. That restriction is not proof of broken sending credentials and must not force a full-access key. Configuration, an authenticated API response, sender-domain verification, accepted mail and recipient receipt are distinct observations. Startup readiness must not claim sender or recipient verification merely because a key exists.

The [official Resend API error reference](https://resend.com/docs/api-reference/errors) documents `restricted_api_key` as HTTP 401 for keys restricted to sending. The domain-read probe recognises only that exact error name with HTTP 401 or 403 as a scope limitation and reports `CONFIGURED`, without asserting domain or recipient verification. Invalid keys and unrelated authorization failures remain blocking errors. This probe distinction does not change email sending or queue outcomes.

## Weekly delivery contract

The explicit recipient policy is `REGISTERED_EMAIL`, version `2`, using the employee's saved account address (`users.email`). This supersedes the older designated-address policy for newly prepared versions. The legacy `timesheet_delivery_email` value is preserved, but is not a fallback. Missing or invalid registered addresses produce a visible setup blocker.

Only eligible actual worked attendance contributes. No-work, zero-hour, planned, cancelled, rejected, deleted or duplicate-only records create no email. Incomplete or inconsistent attendance needs the existing authorised review/correction process. Payroll approval is not invented as a requirement for recognising a worked shift; the report states its real review/approval status. No missing break, timestamp, site, job, approval or hour is fabricated.

The verified production schedule remains **Monday 07:00 Australia/Sydney**, covering the previous completed Monday–Sunday week. The scheduler runs in the application worker without a browser session. Its 120-minute dispatch window, bounded 48-hour latest-week recovery, durable staff/week/revision identity, leases and atomic queue claims remain in place. Whole eligible shifts retain their established local-start-day allocation, including overnight/DST behaviour.

Each report has exactly one To: the employee's registered address. There is no CC, BCC, manager/payroll copy, mailing-list expansion or alternate-address fallback. Account status, address, eligible source records, policy version and frozen report content are rechecked before dispatch. An email/account/source change holds unsafe pending work; it does not rewrite a completed delivery. Old frozen/pending policy versions need an authorised new revision before adopting the current policy. Accepted reports and historical recipients remain immutable.

New routine reports use `HTML` with a plain-text alternative and no attachment. The source and rendered content are immutable, versioned and hashed. HTML sending does not call the optional PDF renderer or require PDF capability checks. PDF generation status is separate from email status; other document workflows retain strict PDF-only attachments. The full attendance, privacy and review contract is in [TIMESHEET_WORKFLOW_AND_EMAIL.md](TIMESHEET_WORKFLOW_AND_EMAIL.md).

## Report email actions

Retained report and document views expose an envelope action where an existing authorised renderer supports it. A typed source descriptor uses the real controller, filters and permissions; the client cannot supply arbitrary HTML, URLs or PDF bytes. Registers cover the complete authorised selection rather than only the visible screen page.

Preparation validates a genuine PDF, its document identity and pages, then writes the exact bytes to the existing private durable object store and reads them back. The additive `manual_report_snapshots` migration stores metadata, source/content hashes and the private object key, not another PDF BLOB. The recipient form exposes preview/download of this prepared version before sending. Preview, download, queue and transport retain the same validated bytes and `.pdf`/`application/pdf` metadata.

Each manual send takes one explicit recipient, a stable request ID and the reviewed PDF hash. The request cannot be reused to change its recipient or snapshot. Source permissions and current record/version rules are rechecked. Accepted and uncertain outcomes remain held against accidental duplicate sending. Existing invoice approval and other record-specific issuance rules must still apply.

## Issue register

| Reproduction / evidence | Cause or boundary | Change / verification required | Remaining limit |
| --- | --- | --- | --- |
| User confirmed Resend domain and explicitly selected registered/login addresses | Previous company policy used a separate designated field and the selected transport was the WordPress relay | Explicit Resend selectors and `REGISTERED_EMAIL` v2 policy, source/account rechecks and frozen-version protections | Key presence is known; real send results must be recorded |
| Existing WordPress relay preflight previously failed its JSON contract | The observed failure occurred before confirmed provider acceptance | Resend is an explicitly authorised transport change; no silent relay fallback | Historical “TMP” origin was not proven and is not attributed to Railway |
| A successful local report or queue admission can be mistaken for email success | Generation, queueing, provider acceptance and inbox receipt are different stages | Keep separate status and evidence; uncertain outcomes require review rather than resend | Actual inbox rendering/opening needs recipient evidence |
| Switching providers could dispatch old pending messages | Old messages lack the current immutable provider admission/binding | Hold legacy/different-provider or changed-content work for review; persist stable provider idempotency keys | No automatic historical backfill or blind retry |
| Ordinary report views lacked one consistent recipient action | Existing per-module endpoints and UI interactions differed | Shared typed-source preparation and one-recipient envelope flow using exact private snapshots | Final candidate browser and source-permission gates required |

## Fresh production reconciliation

The 12 November production reconciliation for **2–8 November 2026** reported **16 `NO_WORK`** and **3 `INELIGIBLE_ACCOUNT`** outcomes. There was no eligible worked-staff delivery to recover in that cohort. Its Monday dispatch time was 9 November 07:00 Australia/Sydney; the bounded recovery window had already ended. Do not manufacture attendance or send zero-hour summaries to create delivery evidence.

Older observations, including the 19–25 October missing designated-address outcome and release PDF request 1/queue 157, are historical. A new policy or provider does not authorise blindly resending them. Reconcile existing snapshots, queue/provider results and uncertainty before any explicitly authorised revision or recovery.

## Verification and release evidence

Candidate and merged-main gates must cover syntax/regression checks, UTC and Australia/Melbourne builds, real MySQL fresh/upgrade/concurrency checks, Chromium/WebKit, staff eligibility/approval, complete reports, immutable PDF/MIME, recipient privacy, stable retries and uncertain outcomes. Browser fixture evidence is distinct from actual private-account actions and physical-device tests. Preserve the existing sidebar/chart/logo gates.

Local verification passed 467 JavaScript syntax checks and the 98-script UTC regression suite. Chromium report controls passed 14 light/dark width cases (320, 360, 390, 430, 768, 1024 and 1440px), exact parser-rendered preview/download bytes, single-recipient validation, duplicate clicks, retained errors, cross-dialog prior-delivery reconciliation, uncertain holds and account switching. The original logo remains `ea69c23f603a79ae6e077798e7ceea6186f139ad2433e364591b1f4054b68312`. The production-style Melbourne gate explicitly selects Resend with a non-working synthetic key: provider fixtures must isolate their selected mock transport rather than inherit production credentials or silently alter application transport checks.

Use the existing separate marker-only `.railway-release` process after the final candidate and merged-main gates pass. Preserve the prior healthy deployment as rollback; retain additive schema, object-store artifacts, records, snapshots, keys and audit history. Observe terminal Railway SUCCESS, then check the live SHA, new asset bytes, unchanged logo, retained/retired routes, registered recipient policy and the Monday worker configuration.

Record the actual candidate/main/marker SHA, workflow run URLs, Railway deployment ID, live verification, controlled fixture queue IDs, provider message IDs and inbox evidence here when available. None is implied by this preparation document.

Production active database TLS with trusted certificate/hostname validation and Android signing/App Links/store distribution are separate integrations. This email/UI release does not prove they are repaired, nor that an installed user received a new native binary. Report their present evidence and exact missing bindings separately.

## First production Resend result

The first release marker `48789b7495bfd4df6e6840432e08281ed3cee26a` deployed application source `e4175eafbe17d6b6810429bc8c481cbe950f5c88` through Railway deployment `2066c2aa-b70b-497b-bb39-36ef46317df7`, which reached `SUCCESS`. The backend completed startup and registered the Monday worker on 12 November at 05:14 UTC. Production retained all 17 original base tables and applied only the additive report metadata migration.

The explicitly authorised fictional release fixtures were each accepted once by Resend at 05:14:31 UTC:

| Format | Queue | Provider message ID | Evidence |
| --- | --- | --- | --- |
| Complete HTML/plain-text timesheet | 158 | `01a1ce2d-cbf7-7836-895b-17baa77f21d3` | One To, no CC/BCC, no attachments; `SENT`, one attempt |
| Parser-validated PDF report | 159 | `01a1ce2d-ce56-793c-81eb-8b5407c1418c` | One To, no CC/BCC; one `application/pdf` attachment with a `.pdf` filename, one valid page, 1,649,444 bytes |

The PDF bytes retained SHA-256 `44b56841e95b2f3bec0102897d37ccedc1fb1d74ae402af039eacd466b25e50f`. These are provider acceptance and retained-byte validation, not recipient receipt or received-MIME proof. Inbox observation remains pending. No employee, customer or supplier data was used for these tests. The fixture configuration was disabled after acceptance without resetting either queue entry or changing its stable identity.

The startup domain-read probe had reported degraded transport despite these accepted sends. Separately, the official API reference confirms the supported sending-only scope error is HTTP 401 `restricted_api_key`; the old check recognised only 403. The follow-up handles exactly that error for both statuses while rejecting invalid keys and unrelated authentication failures. It does not grant domain-listing permission, weaken sending checks or claim recipient verification.

The new runtime reconciliation again found 16 `NO_WORK` and 3 `INELIGIBLE_ACCOUNT` outcomes for 2–8 November: no zero-hour emails or historical reports were sent. The next configured run is 16 November 07:00 Australia/Sydney, covering 9–15 November. Final follow-up release SHA, readiness, matching assets and any recipient evidence are recorded in the PR handoff and external release evidence.
