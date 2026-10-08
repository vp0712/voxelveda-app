# Finance report follow-up repair — 8 October 2026

Production was rechecked before editing. Repository `vp0712/voxelveda-app`, branch `main`, project `e41bb335-4f02-4251-8895-9195dc69726e`, production environment `113e44d2-01a4-4c87-a192-48e15f47dab9`, and app service `7dc16dbd-e670-46ae-9053-ef1b06873f71` match the requested destination. The live revision had advanced to `abe61230fd3f3c05586a416196795867b5acaa3c`, deployment `888d18ea-3bd2-4260-aea7-b4bf7d5f86be`, before this task. The existing snapshot implementation was retained and inspected rather than replaced.

## Resulting behavior

The report builder saves complete immutable, encrypted MySQL snapshots before optional PDF generation. The existing authenticated `/finance/reports/:reportId/view` page renders actual HTML in the integrated app shell. Owner and current account grants are checked server-side; browser login preserves the requested report identity. Full snapshot HTML/print/CSV/XLSX remain available when PDF generation fails. Financial records, permissions and original branding are unchanged by this follow-up.

This update closes remaining gaps:

- Parsed PDF validation checks transaction count, repeated descriptions, transaction amounts, statement running balances and opening/closing/debit/credit totals. Stored PDFs are parsed before email/download reuse. Invalid PDFs regenerate from the same saved snapshot. Failed regeneration preserves independent HTML viewing and cannot invalidate a concurrently replaced valid PDF.
- Relay and queue serialization share binary normalization, including JSON Buffer, typed-array offsets, ArrayBuffer and supported encoded text. Unsupported/missing content fails explicitly. Relay metadata records byte length and SHA-256. Provider acceptance remains distinct from recipient verification.
- Print uses AbortController rather than AbortSignal.timeout, handles blocked/closed popups with a self-contained HTML download, installs the print handler before navigation, and reports authentication errors. Viewer deadlines cover body reads as well as response headers. Expired-session security verification preserves the exact page/query/hash for login return. Download/print responses require the requested MIME type, meaningful filename and nonempty bytes.

The historical direct-send transport trace and inaccessible Gmail/relay evidence are recorded in [finance-email-forensics-20261008.md](finance-email-forensics-20261008.md). Local decoded MIME fixtures are application-boundary evidence, not recipient receipt.

## Verification scope

Targeted regressions exercise parsed multi-page, empty and statement PDFs; forced renderer failure; immutable snapshot restart and owner/account denial; complete HTML/CSV/XLSX reconciliation; escaping/formula protection; durable queue content after temporary source deletion; binary/MIME decoding; viewer print/download/email actions, login return, deadline and popup errors; shared sidebar navigation/Back behavior; chart/theme/filter/mobile navigation contracts.

The existing production build, full regression and GitHub CI gates must pass before the `.railway-release` marker triggers the existing app service. No checks are disabled by this update. Native Safari/Android/WebView tests and authenticated live report screenshots/downloads require a permitted app session and are recorded separately from viewport emulation. The task environment initially has no signed-in app session. No recipient email is sent merely to access an existing report.
