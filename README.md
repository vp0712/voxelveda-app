# Voxel Veda application

Voxel Veda's original operational application is restored selectively from its history, preserving current authentication, security, domain, startup and navy/light-dark theme fixes and the unchanged original company logo. The authoritative boundary is documented in [the restoration matrix](docs/RESTORATION-MATRIX.md).

Original RFQs and invoices, customer statements, customer/supplier records, purchasing, stock/material movements, production and quality, staff/HR, attendance/rosters/timesheets, tasks/meetings, notifications, compliance, recruitment and recoverable archives use the existing records and IDs. Banking, the added Finance OS/ledger and the separate ERP portal remain unavailable; their historical records and encryption keys are preserved.

Document previews, downloads and email attachments contain parser-validated PDFs with safe `.pdf` filenames. Generation, queue status, provider acceptance and recipient receipt are separate states. The existing HTTPS company mail relay requires the receiver contract in [the WordPress repair package](deployment/wordpress/README.md) before document attachments can be sent. Normal account emails retain the existing transport. See [PDF verification evidence](docs/PDF-DELIVERY-VERIFICATION-20261011.md).

Use Node 22.13 or later and an isolated development MySQL database. Run `npm ci`, `npm run check`, `npm test`, `npm run build` and `npm run security:audit`. Disposable database and browser checks are defined by the repository workflows. Never commit secrets, production exports or user uploads.

Authenticated `/dashboard` entries select the original role portal; `/account`, `/profile` and `/security` retain account controls. Public intake is at `/request-quote`, and recruitment is at `/careers`. Business APIs enforce their original scopes and current security controls.

Production remains at https://app.voxelveda.com on the existing Railway service. Candidates pass CI and merge to `main`; merged-main checks pass before a separate `.railway-release` marker triggers deployment. Historical SQL migration checksums are verified without replaying retired migrations. Startup inspects the preserved original schema before additive compatibility changes. Capacity checks roll back their probes; historical records, audit/email histories and archived files are held intact. Recovery redeploys the prior verified code without reversing schema additions or discarding records.

The October 9 removal manifests describe the historical account-only release and are superseded by the corrected restoration matrix. Their broad classification of original business workflows as retired is not the current scope.
