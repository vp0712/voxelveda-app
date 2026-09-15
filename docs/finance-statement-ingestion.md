# Finance statement ingestion

Statement imports follow a controlled two-stage workflow:

1. Parse the source file in the authenticated browser.
2. Send normalized rows plus a SHA-256 file hash to the preview endpoint.
3. Stage every row in `statement_import_sessions` / `statement_import_rows`.
4. Mark malformed rows rejected and existing row hashes duplicate.
5. Review row selection before commit.
6. Commit only selected VALID or WARNING rows under finance permission + step-up authentication.
7. Write the immutable import file record, bank import batch, history coverage and audit event in one database transaction.

Supported browser parsing:
- CSV
- OFX / QFX
- QIF
- XLSX
- PDF with explicit signed amounts or CR/DR transaction direction

PDF parsing is intentionally conservative. If transaction direction cannot be determined safely, the file is rejected and the user is instructed to obtain CSV/OFX rather than guessing debit versus credit.

Direct bank feeds remain disabled until a real Australian CDR/Open Banking provider and consent adapter are configured and verified.
