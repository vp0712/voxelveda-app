# Procurement imports and saved draft entries

This release extends the original procurement workspace. Imported plans, quotations, purchase-order documents and supplier invoices become saved **draft entries**. Importing does not create operational purchase orders, invoices, inventory movements, payments or Banking/Finance records. The original procurement stages remain separate.

## Durable source handling

- The application accepts up to ten files of at most 8 MiB each. Every accepted multipart file receives a retained manifest and an explicit storage, extraction or rejection outcome.
- The exact validated source bytes are stored in the existing private object-storage service when `OBJECT_STORAGE_PROVIDER=railway_s3` is configured. Configuration or storage failures remain failures; the application does not silently change the storage backend.
- When object storage is absent, the durable fallback is MySQL `LONGBLOB`. Local staging is temporary and is removed after the upload request. Success never depends on a local staging file surviving a restart.
- Source metadata records the original name, byte count and SHA-256. Every source read checks the retained bytes against the recorded size and hash.
- Imports use dedicated private metadata and keys. They do not register a broadly visible shared-document UUID. A source's import owner, or a user with explicit `MANAGE_PROCUREMENT_RECORDS`, can read it.
- Raw originals have no download route. Source preview/download returns a parser-validated PDF or a clear unsupported/corrupt-source error. CSV, spreadsheets and supported images are rendered as PDFs; original PDF sources are validated. No alternate attachment or download format is substituted.

## Review and confirmation

The workflow is upload → extraction → worksheet/column mapping → preview → explicit source review/correction → confirmation. Column mappings use zero-based indices rather than untrusted spreadsheet header names. Headerless sheets retain `header_row=0`.

Missing dates, currencies, units, prices and tax values are left unrecorded. Provided fields are validated; amounts are derived only from the supplied quantities, prices and tax inputs. Formula values, merged cells and PDF/image extraction require source review. Malformed source-row errors survive extraction and mapping.

Every data row has an independent retained outcome: `PENDING_MAPPING`, `VALIDATED`, `REVIEW_REQUIRED`, `REJECTED`, `DUPLICATE` or `ACCEPTED`. Header and preamble rows remain identifiable and are excluded from data-row totals. File-level storage and extraction failures are distinct from row-level rejected values. Duplicate rows link retained entries without creating another entry.

Confirmation can select explicit rows. Unselected or rejected rows remain correctable in a `PARTIALLY_COMMITTED` batch. A persisted confirmation receipt binds the preview token to its exact selection, created entry IDs and outcome counts, so repeating that confirmation does not create duplicate drafts. Upload retry keys similarly bind an owner to the exact file manifest.

## Saved entries and access

Saved drafts have stable IDs, readable `PRC-YYYY-NNNNNN` references, source-file links, optimistic revisions and transactional audit history. They support validated create, edit, detail, archive and restore. Archiving preserves records, source attachments and history.

`VIEW_PROCUREMENT` is required for access. Mutations additionally require `IMPORT_PROCUREMENT`, the existing `CREATE_PURCHASE_REQUISITION`, or `MANAGE_PROCUREMENT_RECORDS`. Ordinary access is owner scoped; only explicit `MANAGE_PROCUREMENT_RECORDS` permits cross-owner records.

Search, classification/status/supplier/date/category/priority/phase filters, sorting and pagination use saved database records. Summary totals cover the entire filtered result, rather than the visible page. Money is grouped by classification and currency; quantities are grouped by classification and recorded unit. Missing currency or units are not assigned an invented default or combined into misleading totals. Archived records in historical reports are labelled separately from active obligations.

## Extraction and optional local OCR

Extraction runs in a bounded worker. Limits cover source bytes, decompressed spreadsheet bytes, sheets, rows, cells, PDF pages, text and execution time. Persistent worker claims are fenced by a UUID token, preventing an expired worker from overwriting a newer claim. Extraction failures retain the durable source and support an authorized, reasoned retry.

OCR is optional and disabled by default. Set `PROCUREMENT_OCR_ENABLED=true` only when the runtime has local Tesseract and the Linux `prlimit` tool; scanned PDF OCR additionally needs `pdftoppm`. This adapter sends no files to an external OCR provider. It bounds pages, image dimensions, memory, output size and time. Availability diagnostics distinguish disabled or missing tools from processing failure. OCR output always requires source review; installed binaries alone are not reported as a verified OCR run.

## API surface

- `POST /api/procurement/imports`: multipart `files` (or single `file`), optional `Idempotency-Key`.
- `GET /api/procurement/imports` and `GET /api/procurement/imports/:id`: scoped files, rows, counts and revisions.
- `POST /api/procurement/imports/:id/preview`: mapping, classification, worksheet/header selection and expected batch revision.
- `PATCH /api/procurement/imports/:id/rows/:rowId`: corrected values, explicit review and expected **row** revision.
- `POST /api/procurement/imports/:id/commit`: preview token, expected batch revision and explicit selected/reviewed row IDs.
- `POST /api/procurement/imports/:id/retry-extraction`: expected batch revision and retry reason.
- `GET /api/procurement/imports/files/:fileId/pdf?download=1`: scoped PDF-only source rendition.
- `/api/procurement/entries`: scoped list/create and record detail/edit/archive/restore.
- `/api/procurement/reports/snapshots`: immutable report snapshots, validated PDF download and controlled document delivery. See [PDF report implementation](PROCUREMENT-PDF-REPORTS-20261013.md).

All new schema initialization creates additive tables. It does not drop original application tables, rewrite historical records or rotate encryption keys. Repository integration, disposable MySQL, browser, PDF/MIME and live release evidence must be recorded by the release workflow; this implementation note does not claim those checks or deployment have completed.
