# Responsive repair evidence — 14 October 2026

Baseline: refreshed `origin/main` and production `/api/ready` both identified `62ace8be4287ef083c344174739378b8de9a7660` (Railway deployment `080c17e5-620c-4e9c-9ec5-5a4221542731`). The workspace was clean before this branch. The named IMG_3588 attachment was not available in the execution workspace; its described invoice defect was reproduced using the actual application, routes, controllers and isolated authorised fixtures. No production invoice, customer, employee, attendance or email was changed for evidence.

## Proven cause

At 390px, the original invoice table computed to **1,180px** wide with `min-width:1180px!important`. Its cells and buttons reached x=1,203, beyond the viewport. The real `thead` was already `display:none`; the apparent stacked headings were generated **`td::before` labels**. Legacy mobile cell grids reserved a percentage of the oversized table for labels, pushing the corresponding values off-screen. A later four-column action-grid rule imposed another **330px minimum** inside the record. The local wrapper contained scrolling, so the document-width test alone missed the unreadable values.

The API and DOM both contained invoice `INV-TEST-0091`, customer `Restoration fixture`, total 110, paid 0 and outstanding 110. This was a layout failure, not missing API data. See [before measurements](evidence/responsive-20261014/before-invoice-measurements.json) and [the visible defect](evidence/responsive-20261014/before-invoice-record-390.png).

Separately, the invoice UI fetched only the API's default first 50 rows and then applied local filters and totals. That could silently omit later records. The PDF popup used `noopener` and treated a null window handle as a blocked popup, causing unintended parent navigation. Both were repaired.

## Changes

- Removed the conflicting late invoice minimum-width/action-grid rules. A final shared responsive foundation restores semantic tables above 700px and uses labelled record cards below it. Invoice cards reuse the same table DOM, values, IDs and handlers; there is no duplicate desktop/mobile register. Wide retained tables scroll within a named, keyboard-accessible region with a visible scrolling hint.
- Added shrinkable containers, wrapping references, reachable touch targets, measured navigation padding, safe-area spacing, internally scrolling dialogs, viewport-height keyboard handling, focus restoration and native secondary-action menus. Background scroll locking is scoped to an open overlay. No global horizontal-overflow hiding is used to conceal defects.
- Compact invoice header and creation menu; expandable backend filtered totals; reference/customer/status/date/total/paid/outstanding on phone cards; primary View invoice and accessible PDF plus permission/status-scoped More actions. Detail shows items, payments, activity and the related RFQ. Original approval, QR, send, manual/RFQ creation, payment, archive and restore remain.
- Invoice search, status, sort and pagination now run against the authorised backend. Totals cover all filtered records rather than the page. Missing amounts remain “Not available”; genuine zero stays zero. RFQ, customer and supplier registers fetch complete authorised pages before existing local filters. Invoice editing detects a stale document revision before writing. Date filters reject impossible calendar dates and reversed ranges.
- Payments retain a stable request identity and saved original payload across uncertain responses and page re-entry. A read-only receipt route reconciles persistence before retry; retries reuse that identity. Existing transactional balance validation, duplicate prevention, audit, historical payment void and invoice archive/restore remain authoritative.
- Local PDF.js renders the authorised validated PDF bytes with fit, zoom, page and download controls. The document layout is separate from app table CSS. Preview, original and download use the same bytes; retained document/email contracts and parser validation are unchanged. Procurement/source/statement/report previews use a controlled same-origin viewer without re-fetching a different document version.
- Procurement operational totals are expandable, with missing/loading values distinguished from zero. Extraction/review, accepted/rejected/duplicate outcomes, durable Uploaded files, saved editing, recoverable archive/restore and complete selected-record reports remain intact.

## Retained route and role inventory

Source inventory: `app.js`, `config/permissionCatalog.js`, retained route modules and existing portal navigation. No role or grant was introduced.

| Area | Retained routes/views and verification scope |
| --- | --- |
| Entry/account | Home, login, signup, recovery/reset, invite, MFA, account, profile/security, support/privacy/terms. Home remains only Login and Sign up plus legal links. Signup remains viewer/customer; employee access uses existing invitation policy. |
| Staff/team | Existing staff, manager, supervisor, HR, production and sales homes; own attendance/scanner/timeline, roster, timesheets, tasks and permitted team/review/document actions. Supported role-home fixture matrix and attendance regression tests; no invented roles. |
| Admin/commercial | Existing admin/super-admin and original finance permission roles use the same retained Admin application. RFQs/quotations, invoices, customers, suppliers, inventory/stock/materials, expenses, staff/access, rosters/timesheets, meetings/tasks, compliance/forms, settings, approvals and trash remain. Populated RFQ/invoice/QMS/Admin fixture journeys are exercised; not every specialised form is claimed as separately tested on every width. |
| Clients | Existing viewer/view-only/client/customer portal and authorised own records/documents. Server permission/customer isolation remains; no self-selected privileged role. |
| Procurement | Saved entries, Uploaded files/import review, requisitions, sourcing, purchase orders, receiving, bill matching, returns and Master BOM. Existing complete import/report fixture workflow plus seven-width light/dark matrix. |
| Documents/production | Protected invoice and common viewers, quality/shop-floor, employee credential and careers administration retain original guards. Actual PDF parser/render/download checks; existing job/task/workflow permissions unchanged. |
| Retired additions | Banking/Finance OS and separate added ERP stay HTTP410. Original invoicing, procurement and commercial functions remain. |

## Verification

| Check | Evidence/result |
| --- | --- |
| Invoice layouts | 320, 360, 390, 430, 768, 1024, 1440px plus 844×390 landscape, both themes: 16 cases, no document overflow; phone fields/actions fit without hidden overflow; desktop headers remain semantic. All displayed row amounts compared with API fixtures. |
| Populated workflow | 75 invoices over three API pages; long names/references; null vs zero; search/filter totals; detail at 320px; enlarged layout; simulated 360px keyboard viewport; list 503/retry/empty; PDF controls/download; lost payment reply reconciled without a second submission. Transport loss is explicitly simulated; transaction/idempotency controllers are covered by retained regression/SQL checks. |
| Staff/roles | 16 layout cases with notifications open; retained owner/private photo cache replacement, account switching, role-home matrix, actual scanner on emulated video, checkout notes/correction flows. [Proof](evidence/responsive-20261014/staff-workflow-proof.json). |
| Procurement | 14 width/theme cases, extraction/review/edit/import duplicates, separate durable source storage, paging/filter reports, archive/restore, readonly permissions and real PDF reports. [Proof](evidence/responsive-20261014/procurement-workflow-proof.json). |
| Original business | Real Express cookie/JWT/CSP fixtures; RFQ saved edit/refresh/history/archive/restore; original invoice approval step-up; Admin/staff/client/QMS; identical SHA256 parser-valid PDF preview/download. [Proof](evidence/responsive-20261014/retained-workflow-proof.json). |
| Accounts/public | Seven widths plus landscape; profile/security navigation and refresh; home/login/signup/recovery/reset in both themes; no page overflow or clipped controls. Live release verification additionally checks public routes and anonymous protected boundaries. |
| Required gates | Normal and production HTTPS + required scanner + selected S3 builds; 71 mandatory suites including permission matrix, invoice concurrency/idempotency, retained PDF MIME/parser, procurement, attendance breaks/overnight/DST/summary, weekly worked-only designated-recipient policy, private avatars/notifications and retirement boundaries. Syntax, source provenance, secret scan and production dependency audit. Exact candidate/merged CI and release recorded in `.railway-release`. |
| QR retained | Branded gate actual rendered-image decoder, rotations, delayed next-image load, expiration/outage/reconnection plus 240 decoder samples in the mandatory QR suite. Existing original centre logo/token/login/attendance safeguards remain. |

## Before / after screenshots

All private screens below are clearly isolated fixture records using real application assets/controllers. Baseline screens are pinned to the previous production commit above.

| Screen | Before | After |
| --- | --- | --- |
| Invoice phone | [Broken record](evidence/responsive-20261014/before-invoice-record-390.png) | [390px register](evidence/responsive-20261014/after-invoices-390-light.png), [320px record](evidence/responsive-20261014/after-invoice-record-320.png) |
| Invoice desktop | [Table](evidence/responsive-20261014/before-invoices-1440-light.png) | [Table](evidence/responsive-20261014/after-invoices-1440-light.png) |
| Invoice controls | — | [Detail](evidence/responsive-20261014/after-invoice-detail-320.png), [keyboard simulation](evidence/responsive-20261014/after-invoice-keyboard-320.png), [PDF](evidence/responsive-20261014/after-invoice-pdf-320.png) |
| Staff | [Home](evidence/responsive-20261014/before-staff-home-phone.png) | [Home](evidence/responsive-20261014/after-staff-home-phone.png), [notifications](evidence/responsive-20261014/after-notifications-phone.png) |
| Admin | [Home](evidence/responsive-20261014/before-admin-phone_portrait-light.png) | [Home](evidence/responsive-20261014/after-admin-phone_portrait-light.png) |
| Procurement | [Phone](evidence/responsive-20261014/before-procurement-phone-light.png) | [320px](evidence/responsive-20261014/after-procurement-width-320-light.png), [desktop](evidence/responsive-20261014/after-procurement-width-1440-light.png) |
| Client | [Phone](evidence/responsive-20261014/before-admin-client-phone.png) | [Phone](evidence/responsive-20261014/after-admin-client-phone.png) |

## Release and limits

Release: checked candidate PR → exact merged-main CI → dedicated `.railway-release` change → existing Railway service/domain. The previous deployment/commit `62ace8be…` remains the rollback target. No migration, production data rewrite, credentials, provider, SMTP relay, DNS or permission change is required.

No physical iPhone/Android, Safari, native WebView or real on-screen keyboard was available. Chromium viewport/enlarged-layout/visualViewport simulations do not establish those results. No designated production test identity was supplied, so live private invoice/attendance/photo/notification records cannot be exercised without using a real person's records; they remain unverified in production. Live public pages, exact commit/assets/service-worker and anonymous permission boundaries are verified separately after release. The earlier physical-camera failure remains inconclusive. The outstanding WordPress PDF relay delivery blocker is unchanged and is not resolved by layout work.
