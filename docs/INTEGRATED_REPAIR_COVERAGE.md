# Integrated ERP and Finance repair — 7 October 2026

## Running source and release destination

Repository: `vp0712/voxelveda-app`. Baseline: `main` at
`a65aa65557ea5b8789eeccb0b2e86480c1a2f295`. Express/CommonJS backend at the
repository root, static vanilla-JavaScript frontend in `public/`, MySQL through
`config/db.js`, npm with committed `package-lock.json`. Existing CI uses Node 22;
local verification uses Node 24.19.0. No separate Finance application is created.

Existing Railway destination: project `victorious-fulfillment`, production
environment, service `voxelveda-app`. Baseline successful deployment:
`82a19d40-1865-4147-8772-2681f211dfe9`. Its readiness revision and served admin
JavaScript SHA-256 matched the baseline source. The source-connection display had
an older commit field, but the actual deployed revision and assets matched.

The defects originate in conflicting global/inline light and dark palettes,
hardcoded Chart.js canvas colours, tiny category labels, a separate Finance
navigation shell, omitted RFQ statuses, inconsistent financial drill-down
filters, split-category allocation and misleading payable/date/balance labels.
The baseline build and runtime were healthy; stale deployment was not the cause.

The existing release workflow remains candidate branch → CI → PR → green checks
→ merge → dedicated `.railway-release` marker commit → Railway build/start →
live verification. Do not change the marker in a feature candidate.

## Coverage checklist

“Regression” means isolated fixtures and source contracts, not mutation of real
production records. Live read-only checks and screenshots are recorded separately
after deployment. Original logo bytes and production records are preserved.

| Module / route family | Inspected / repaired | Verification |
|---|---|---|
| Shared shell, role portals, login/profile/security | Tokens, role navigation, one primary mobile bar, preference, forms/errors/focus | Permission/role/security regressions; contrast pairs; original-logo contract |
| ERP workspace / dashboard | Shared layout, all six canvas charts, accessible values, full status coverage, source links and Back | ERP, button-activation and chart behaviour fixtures |
| RFQs, invoices, customers / sales | Readable registers, status/date drill-downs, chart reconciliation; removed invalid invoice trend | Register/action, invoice/PDF, export and permission contracts |
| Suppliers, procurement, expenses / payables | Exact category labels, settled/partial/zero amounts, voided payments, actual overdue dates, upcoming outstanding amounts | Procurement/lifecycle fixtures; payable regression and isolated MySQL totals |
| Stock, movements, raw material, packaging, operations | Shared responsive tables, controls and semantic text/status colours | ERP operations/workflow and action contracts |
| HR, attendance, roster, tasks, meetings | Shared layout, readable forms/cards and navigation | Workforce/workflow, ownership and role fixtures |
| Alerts, approvals, documents, settings, trash | Shared colours/focus, dialogs, existing audit/recovery and permissions | Document/security, notification, deletion/restore and action fixtures |
| Finance overview, accounts, transactions | Same ERP shell; provider/account grouping, masked ID, balance basis, compact full category list, exact period/currency/allocation links | Core Finance, owner/grant isolation, filter/trusted-totals and MySQL fixtures |
| Finance statement vault / imports / review | Existing durable originals and OCR retained; real statement gaps; currency rejection; strong overlap dedupe and ambiguous-match review | Real generated CSV/PDF/XLSX/OFX/QIF/scanned fixtures; source/evidence, multi-file, timeout, correction and provenance fixtures |
| Categories, budgets, reports, borrow/lend and all Control Centre modules | Shared theme propagated into injected CSS; internal module search, navigation and touch-accessible values | Full-surface, budgets/rules, debt/lifecycle, control-centre and report fixtures |
| PDF / CSV / XLSX and report email | Existing original-brand reports and secure delivery boundaries preserved | Generated PDF content/MIME, XLSX and email attachment/relay fixtures; actual mailbox receipt requires a configured recipient |
| Startup / deployment / caching | Existing binding, readiness, migrations/storage/scanner/Redis chain retained; local locked Chart.js and versioned shared assets | Production build, dependency audit, real CI and post-deployment readiness/revision/log checks |

## Financial definitions

ERP dashboard revenue is gross issued invoices in the selected Australian
financial year; expenses are gross recorded bills in that same year; net is their
difference. Collected cash is labelled separately. Bank cash debits exclude
confirmed internal transfers; a text category named Transfer is not ownership
evidence. Refund cash is separated from ordinary income, split amounts replace
parent category amounts, and currencies remain separate. The cash-custody ledger
remains distinct from source bank cash movement, avoiding automatic addition of
cash-wallet purchases to withdrawal totals.

The `integrated-repair-mysql-test.js` suite refuses to run without explicit opt-in
and the disposable `voxelveda_repair_test` database. It never uses production
configuration. Historical repairs remain reviewable through the existing source
evidence repair workflow; this release does not rewrite historical transactions.

## Known external verification limits

The configured custom app domain has a DNS/certificate issue independent of this
release. Railway requires CNAME `app → l77jn3h9.up.railway.app` and TXT
`_railway-verify.app → railway-verify=e9d97aebbcb0342135ecf3f8ca0cd3e3ad5c51ae87b7853f7a81ff3300bbce40`.
The working existing Railway address is
`https://voxelveda-app-production.up.railway.app`.

The MANAGE_USERS-protected `/internal/layout-check` renders the same deployed ERP/Finance code and authenticated data at 320/375/390/430/768/1024/1440 CSS pixel widths, with rotation and 200% layout emulation. Only these diagnostic copies allow same-origin framing; normal app routes retain DENY.

Actual iPhone/Safari hardware is unavailable in this execution environment. A
desktop browser result is not claimed as a real-device test. Open release gate
#183 remains open for that real-device/multi-bank production matrix. Existing
provider assurance items (MySQL TLS, backup restore evidence, Basiq live consent,
multi-replica Redis proof) are not silently marked complete by this UI repair.
