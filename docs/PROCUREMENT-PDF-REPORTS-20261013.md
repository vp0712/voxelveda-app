# Procurement PDF reports and source previews

This change extends the original procurement application. Saved imported/manual documents stay draft records; they do not create orders, inventory receipts, payments, Banking records or an ERP portal. Historical master BOM content is included only when the caller explicitly selects the `catalog` source and is labelled as reference estimates.

## Frozen reports

`POST /api/procurement/reports/snapshots` accepts `type` (`register`, `items`, `suppliers`, `summary`, `selected`, `individual`, or `import-outcomes`), `source` (saved `entries`, native `purchase-orders`, `receipts`, `requisitions`, `workflow`, or explicit `catalog`), filters and an optional exact ID selection. Individual reports require `record_id`; complete import outcomes require `batch_id`.

The source query reads all matching authorised records in one database transaction, independently of the visible UI page. Selected IDs constrain the database query before its limit; any missing or inaccessible ID prevents a partial selected report. Supported register filters include search, classification, status/archive, supplier, currency, date interval, category, priority, phase and the source's supported sort. Unsupported filters fail explicitly. Reports are bounded to 2,000 records and 10,000 item lines; import outcomes include the complete chosen batch, up to 5,000 rows. These limits never silently truncate a report.

`procurement_report_snapshots` retains the immutable source, source hash, document reference/version, complete validated PDF bytes, PDF hash/page count, generation status and diagnostic. Persistent uniqueness and generation leases protect identical requests and concurrent retries. Generation failure retains its snapshot and sends no substitute. Preview and download use `GET /reports/snapshots/:id/pdf`, with `download=1` selecting attachment disposition. Status is available at `GET /reports/snapshots/:id`.

`POST /reports/snapshots/:id/send` requires company-email authority and one explicit recipient. It validates and queues the existing frozen PDF bytes, without rendering a different attachment. The shared delivery service re-parses all pages and checks the intended document content, filename and stored byte hash. The queue retains generation, pending/retry/failure, provider acceptance and recipient verification separately. A repeated source/recipient request reuses its existing queue entry. Uncertain acceptance requires review rather than an automatic second message.

Native purchase-order preview/download/send use the original PO template through this same frozen snapshot pipeline. The supplier identity, quantities, tax and all line/parent totals must agree. A non-approved order remains visibly draft and cannot be sent as an approved purchase order. Its approved status and content are checked again before queue insertion.

## Accurate scope and totals

Saved-entry and import reports enforce the same owner scope as the underlying records. `MANAGE_PROCUREMENT_RECORDS` supplies explicit access to other owners. Generic queued-document downloads delegate to the report/entry scope rather than granting access from `VIEW_PROCUREMENT` alone.

Amounts are summed in integer cents, grouped separately by currency and business basis. Plan estimates, quoted/draft document values, approved native order commitments and receipt quantities remain distinct. No currency conversion, inferred payment or banking balance is created. Missing currency/amount/unit values are disclosed; unlike or unknown units are not added. Archived/cancelled amounts and quantities selected by the filters appear in separate historical groups, while current obligations remain distinct. Full filtered values therefore agree with the register. Import outcome PDFs show every uploaded filename, sheet/row identity, accepted/rejected/duplicate/review status, saved diagnostic and authoritative counts.

## Source preview is PDF only

`GET /api/procurement/imports/files/:fileId/pdf` authorises the source owner, reads durable source bytes and checks their saved hash. Genuine PDFs are fully parsed; JPEG/PNG scans are placed into actual PDFs; supported UTF-8 CSV and XLSX tables are converted without executing spreadsheet formulas. The complete supported tables are included. Encrypted/oversized/corrupt or unsupported sources return an explicit failure while the original bytes and diagnostics remain preserved. There is no raw-source or alternate-format download fallback.

The converter bounds compressed/expanded workbook content, declared sheet ranges, rows, columns and cells before constructing a preview. Long or oversized tables fail rather than producing clipped or partial pages. All successful app responses declare `application/pdf` and a safe filename ending in `.pdf`.

## Verification recorded for this candidate

- `scripts/procurement-report-pdf-test.js`: complete 120-record register across nine pages; individual, items, supplier, summary, selected and native PO documents; exact currencies/units/business basis; unavailable selection; import filenames/row outcomes; CSV/XLSX source conversion; oversized/unsupported/integrity failures.
- `scripts/document-delivery-lifecycle-test.js`: frozen preview bytes pass unchanged into the queue; rendering is not repeated; a wrong retained hash sends nothing; generation/queue rollback and idempotency remain covered.
- Existing `document-pdf-delivery-test.js`: complete parser validation, genuine Nodemailer MIME decoding, correct PDF metadata, corrupt/non-PDF rejection and unsafe relay prevention.
- Existing `weekly-timesheet-pdf-test.js`: single-page, overnight/DST and five-page individual reports remain valid after the shared table-title layout fix.

Representative Poppler renders in `docs/evidence/procurement-pdf-20261013` were inspected for readable tables, aligned amounts, repeated headers, unclipped text and page numbering. The single-entry report occupies one page; the register's last page includes item 120 and the correct AUD 1,327.20 total. Shared layout now keeps section titles with their table header and first row. PDF.js text bounds also confirm no horizontal overflow in the individual, register and import outcome fixtures. The manifest records actual parser page counts, bytes and hashes from generated fixture PDFs.

These are candidate code/fixture results. They are not proof of production deployment, WordPress receiver installation, recipient delivery or opening. No real email was sent by these tests. Live deployment and received-message evidence must be reported separately by the release workflow.
