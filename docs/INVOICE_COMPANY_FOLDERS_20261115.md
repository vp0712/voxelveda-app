# Automatic invoice company folders

Invoices now have a Company folders area in the existing Admin, staff/role and client registers. The All invoices view remains available. Opening a folder shows that company's matching invoices with the existing View, PDF, email and permitted edit/archive actions.

## Identity and preservation

These are read-only organisational views over existing invoice records, rather than copies or a new document store. New invoices appear automatically; authorised edits and archive/restore update folder membership on refresh. Original IDs, files, links, payment history and audit records remain intact. No schema migration or historical record reassignment is needed.

The retained invoice schema stores company-name and customer-email snapshots, without an authoritative customer foreign key. Folders therefore use trimmed, case-normalized name/email pairs. Different saved mailboxes remain separate even when company names look identical. A missing email is labelled explicitly; completely unidentified invoices each have their own Unassigned folder. This does not merge customer accounts or guess which different contacts represent one legal company.

Folder keys are opaque SHA-256 values with a versioned, length-prefixed UTF-8 identity. They remain independent of pagination, status and archive filters. A key identifies a view and never grants access.

## Lists, permissions and reports

- `GET /api/invoice/folders` applies the original invoice permissions and authenticated customer ownership before aggregation. It supports complete matching counts, server pagination, permitted sorting, existing invoice filters and an independent literal `company_search`.
- `GET /api/invoice?folder=…` returns the original invoice response contract for an exact folder. Explicit malformed or empty folder selectors fail validation; clearing a selection omits the parameter.
- Company and record pagination are separate. The staff register uses server pagination and complete filtered totals, replacing its former first-response-page filtering and totals.
- Existing invoice archive authority remains required to browse archived records. Client users can only see their own authorised invoice identities, counts, contents and PDFs.
- Folder selection persists through refresh and Back/Forward. Account, request and selection guards prevent delayed responses from restoring another account's company data.
- Register PDF download and email descriptors retain the exact folder filter across every source page. Invalid selectors fail before source reads; reports do not silently broaden to all companies. Unknown payment totals remain unknown.

Company folders have loading, distinct empty/failure, retry, search and pagination states. Buttons retain accessible names and at least 44-pixel targets. Names and email addresses render as text. Styling is scoped to invoice content; the current sidebar, dashboard chart functions, original logo and compact action icons stay unchanged.

## Verification and release

The focused unit gate covers folder keys, validation, query binding, pagination, identity boundaries and unknown totals. The disposable MySQL fixture exercises the real grouping/controller queries against historical column collations, multi-page companies, distinct accounts, missing identities, persisted edit/archive/restore and new invoice membership. The browser gate covers all three real portal surfaces, responsive themes, filters, history, recovery and delayed account changes. Full-selection PDF and email-descriptor tests preserve the selected company.

Run the existing regression, UTC/Melbourne, real MySQL, Chromium/WebKit and release gates. Release only the gated candidate through the separate marker workflow; verify Railway terminal success, exact live SHA/assets, authentication and retired-system boundaries. Record actual run/deployment and screenshot evidence in the PR handover.

The automatic-final timesheet policy, registered-recipient Resend delivery and Monday schedule are unchanged. Banking and the added ERP portal remain retired. This feature makes no native signing/distribution, provider, billing, DNS or production database-transport changes.
