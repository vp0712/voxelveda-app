# Voxel Veda Finance OS Production Capability Audit

## Architecture decision

There is one Finance OS frontend: `public/finance-intelligence.html` + `public/finance-master.js` + `public/finance-master.css`.
Backend modules remain modular under `/api/finance/*`. No Finance V6/V7 or duplicate banking dashboard is introduced.

## Capability inventory

| Feature | Backend | UI before rebuild | Data/API | Coverage | Classification | Action |
|---|---|---|---|---|---|---|
| Bank accounts | Mature | Basic list | bank_accounts, intelligence/accounts | Strong lifecycle tests | COMPLETE backend / PARTIAL UI | Build account workspace |
| Bank transactions | Mature | Basic table | bank_transactions, intelligence/transactions | Existing privacy + finance tests | PARTIAL | Add server filters, pagination, detail/edit |
| Original bank evidence | Mature | Limited drawer | bank_transaction_original_data | Dedicated regression | COMPLETE backend / PARTIAL UI | Expose provenance |
| Statement import/review | Mature | Redirect/limited | statement_import_* | Protected review tests | BACKEND COMPLETE / UI PARTIAL | Inline wizard |
| Duplicate protection | Mature exact hash + review states | Minimal | row_hash/import sessions | Import tests | COMPLETE core / PARTIAL UX | Review labels/queues |
| Reconciliation | Mature | Legacy redirect | reconciliation_matches | Reconciliation tests | BACKEND COMPLETE / UI PARTIAL | Integrate master UI |
| Account lifecycle | Mature | Basic detail | bank_accounts | Lifecycle tests | COMPLETE backend / PARTIAL UI | Full workspace + danger zone |
| Open Banking | Foundation/fail-closed | Readiness only | bank_connections/provider config | Banking readiness tests | PARTIAL / NOT CONFIGURED in production | Show truthful status |
| Personal Money | Large owner-only module | Mostly hidden | personal_money_* | Privacy/domain tests | BACKEND COMPLETE module / UI DISCONNECTED | Consolidate into My Money |
| Budgets | Personal + banking implementations | Display-only/basic | personal_money_budgets, finance banking budgets | Unit/regression | DUPLICATED/PARTIAL | Present coherent UI; later canonicalise |
| Savings | Personal goals | Mostly hidden | personal_money_savings_goals | Existing tests | PARTIAL | Expose with disclosure that contribution does not move ledger |
| Borrow/Lend | Owner-only lifecycle | Display-only | personal_money_debts/payments | Existing tests | PARTIAL | Expose payment lifecycle |
| Recurring | Personal + intelligence detection | Mostly hidden | personal_money_recurring_items, insights | Existing tests | PARTIAL | Consolidate UI |
| Insights/rules | Mature suggestion engine | Hidden | finance_transaction_insights/rules | Existing tests | BACKEND COMPLETE | Expose |
| Supplier bills/payables | Mature | Admin-centric | supplier_bills/payments | Existing finance tests | BACKEND COMPLETE / UI PARTIAL | Company command centre |
| Accounting periods | Mature lock controls | Hidden | accounting_periods | Finance domain tests | COMPLETE backend | Surface controls |
| Secure documents | Object storage + malware scan | No finance receipt centre | finance documents + storage services | Infra tests | BACKEND ONLY | Receipt centre remains genuine gap |
| OCR | No verified provider | None | none | none | UNAVAILABLE | Do not show OCR as working |
| Splits | No canonical model | None | none | none | NOT SUPPORTED | Requires migration + accounting semantics |
| Refund links | No canonical relationship model | None | none | none | NOT SUPPORTED | Requires model + trusted totals |
| Reimbursements | No canonical lifecycle model | None | none | none | NOT SUPPORTED | Requires model + approval/payment linkage |
| FX reporting | No trusted shared FX-rate store | Unsafe selector | currency fields only | no conversion test | BROKEN UI / UNSUPPORTED conversion | Native-currency mode until FX evidence exists |
| Payments | Internal approval/instruction workflow | Hidden | banking_payment_requests | High-risk controls | PARTIAL | Never label as bank transfer execution |
| PDF/CSV | Accountant PDF + trial balance CSV | Sparse | exports | export security tests | PARTIAL | Build report builder later |

## Highest-priority correctness defects confirmed

1. Master period selector did not send date filters.
2. Master account filter was sent but ignored by banking-dashboard.
3. Currency selector could relabel numeric values without FX conversion.
4. Base API failures were swallowed into empty objects/zero-looking UI.
5. Transaction table did not use the backend's pagination contract.
6. Transaction endpoint lacked requested date/amount/currency/source/reconciliation filters.
7. Transaction summary counted transfers as ordinary money-in/out.
8. Statement button redirected instead of providing an in-context workflow.
9. Cash/Budget/Savings/Borrow & Lend surfaces did not expose existing backend actions.
10. CSP report endpoint sat behind CSRF middleware, creating false browser telemetry failures.

## Canonical-truth boundary

The canonical banking ledger is `bank_transactions` plus linked source/import/reconciliation records. The traditional accounting ledger is `finance_transactions`/journals. Personal Money currently has its own owner-isolated tables and therefore must not be silently combined into company/bank totals. Until a formal bridging relationship is introduced, the UI must label Personal Money modules as separate owner-only tracking rather than mathematically merge them into canonical bank totals.

## Genuine model gaps

Canonical transaction splits, linked refunds, dedicated reimbursements, receipt-to-transaction workflow/OCR and verified FX reporting are not complete. These must not be represented as COMPLETE until database model, authorization, audit, reporting semantics and production tests exist.
