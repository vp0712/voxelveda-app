# Phase 6 — High-risk banking and payroll controls

Phase 6 adds server-enforced controls for supplier and employee banking data and unusual supplier payments.

## Controls

- Full BSB, account number and account name are encrypted with AES-256-GCM using `FINANCE_ENCRYPTION_KEY`.
- List and summary APIs expose only the final four account digits.
- Revealing complete bank details requires the relevant permission and a fresh Level 3 step-up session.
- Every reveal is audit logged without recording the plaintext banking values.
- Supplier and employee bank-detail changes enter a pending request and require a different authorised user to approve them.
- The initiator cannot approve or reject their own request.
- Activating a change supersedes the previous record while preserving history.
- Supplier bank changes are marked recent for `BANK_DETAIL_RECENT_DAYS` (default 7 days).
- Supplier payments at or above `HIGH_RISK_PAYMENT_THRESHOLD` (default AUD 5,000), or payments following a recent supplier-bank change, require independent approval.
- Approved high-risk payments can only be executed by their original initiator and are marked executed atomically with ledger posting.

## Production variables

- `FINANCE_ENCRYPTION_KEY`: required unique 32-byte hex or base64 key.
- `HIGH_RISK_PAYMENT_THRESHOLD`: optional decimal amount; defaults to `5000.00`.
- `BANK_DETAIL_RECENT_DAYS`: optional positive day count; defaults to `7`.

Dual approval for the high-risk conditions above is mandatory and has no production bypass flag.

Never reuse `JWT_SECRET` or `MFA_ENCRYPTION_KEY` as the finance encryption key. Back up the finance key securely; losing it makes encrypted bank details unrecoverable.
