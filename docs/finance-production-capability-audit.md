# Voxel Veda Finance OS — Current Production Capability Audit

## Architecture decision

Voxel Veda has one Finance OS frontend:

- `public/finance-intelligence.html`
- `public/finance-master.js`
- `public/finance-master.css`

Backend modules remain modular under `/api/finance/*`. Retired Finance V3/V4 and premium Banking frontends are removed from the active production tree. `/banking` remains only as a compatibility redirect into the single Finance OS; modular backend APIs remain permission-controlled.

## Canonical financial truth

The canonical banking cash ledger is `bank_transactions`, with linked source/import/reconciliation/relationship records. The accounting ledger remains `finance_transactions`/journals for accounting-domain entries. Personal Money remains owner-isolated and is surfaced as a separate personal planning view; it is not silently added to company banking totals.

## Current capability inventory

| Feature | Current implementation | Classification |
|---|---|---|
| Accounts | Full create/edit account workflow, account cards/workspace, history coverage, lifecycle controls, protected danger zone | READY backend / integrated UI |
| Transactions | Server pagination/filter/search, manual canonical movements, classification edit, recoverable wrong-entry deletion/archive/restore and source evidence | READY core / production workflow verification continues |
| Original bank evidence | Immutable `bank_transaction_original_data` separated from current classification | READY |
| Statement import | CSV/PDF/OFX/QFX/QIF/XLSX protected preview/review/duplicate/commit pipeline plus multi-file historical staging per account and an ordered Setup Centre migration checklist | READY core / integrated history centre |
| Duplicate protection | Exact row hash plus review classification | READY |
| Reconciliation | Master-UI integration over the existing reconciliation centre | READY |
| Receipts | Private secure documents, malware scan, protected download, attach/unlink | PARTIAL until production user-flow verification |
| Splits | Canonical child allocations with exact parent-total validation and no double counting | PARTIAL until production user-flow verification |
| Internal transfers | Explicit debit/credit pair relationship, same-currency validation, excluded from income/expense | PARTIAL until production user-flow verification |
| Refunds | Explicit refund-to-expense links, same-currency and remaining-balance validation, trusted-total netting | PARTIAL until production report/user-flow verification |
| Reimbursements | Draft/submit/approve/reject/payment-link lifecycle | PARTIAL until production user-flow verification |
| Cash | Canonical cash account creation plus owner-only Personal Money wallets, explicit-FX movements, zero-balance archive and controlled restore | PARTIAL pending authenticated production journey verification |
| Budgets | Personal budgets plus banking-ledger budgets with create/update/remove or archive controls and usage tracking | PARTIAL pending authenticated production journey verification |
| Savings goals | Goal management, pause/resume and explicit progress contributions that do not silently move bank cash | PARTIAL pending authenticated production journey verification |
| Borrow & Lend | Owner-only debt detail, due-date/note/counterparty maintenance, repayment history and repayment workflow | PARTIAL pending authenticated production journey verification |
| Recurring money | Personal recurring create/complete/archive/restore lifecycle plus finance-intelligence suggestions; no bank execution | PARTIAL pending authenticated production journey verification |
| Categories | Original bank category preserved separately from editable system category; category manager exposed | PARTIAL |
| Rules | Suggestion-only merchant/category rules with priority | READY core |
| Insights | Spending-health cards, top-merchant concentration, recurring commitments, runway/safe-to-spend signals and evidence-backed transaction insights | READY core / integrated UI |
| Company Finance | Dedicated business bank ledger plus real customer invoice receivables/payments, supplier payables, assets, approvals and accountant controls | PARTIAL pending authenticated production journey verification |
| Personal Money | Dedicated personal bank-ledger workspace plus separately labelled owner-only wallets, briefing, budgets, goals, debts, recurring, saved views and planning intelligence | PARTIAL pending authenticated production journey verification |
| Consolidated | Side-by-side Personal and Company bank dashboards with ownership-preserving drill-down and no cross-currency aggregation | PARTIAL pending authenticated production journey verification |
| Reports | Specialized standard catalogue (cash flow, bank-style account statement with running balance, category, merchant, cash, transfers, refunds, reimbursements, GST review, reconciliation, data quality, Personal/Company monthly) with saved definitions and protected branded PDF/CSV/XLSX exports | PARTIAL pending authenticated production journey verification |
| Notifications | Unified notification centre, delivery preferences, Banking command-centre attention, and per-user low-balance/large-transaction/budget/payment/sync/unusual-activity alert controls | PARTIAL pending authenticated production journey verification |
| User preferences | Default workspace/account/period/format/dashboard cards | PARTIAL |
| Team access | Server-enforced role controls plus per-business-account VIEW/PREPARE/APPROVE/MANAGE delegation and audited revocation UI | READY core / integrated management UI |
| Accounting period locking | Open/review/ready/locked transitions with protected lock workflow | READY core |
| Open Banking | Unified provider readiness, consent-session launch, connected-bank sync/disconnect and sync history; still fail-closed when provider configuration/live enablement is incomplete | RUNTIME STATUS |
| Receipt OCR | No verified OCR provider | UNAVAILABLE |
| FX reporting | Owner-scoped explicit FX evidence register, direct Currency Centre navigation and reversible management conversion layer; native bank values remain authoritative and missing rates fail closed | PARTIAL pending authenticated production journey verification |
| Banking operations | Money Spaces, beneficiaries, draft/submit/independent-approval/cancel payment instructions are integrated in the unified Finance OS; external execution stays capability-gated | PARTIAL / external execution NOT SUPPORTED |

## Correctness defects already fixed

1. Period selector sends explicit `from`/`to` ranges to compatible APIs.
2. Account filters are enforced server-side where supported.
3. Currency selector no longer relabels AUD as another currency; mixed currencies remain separated without verified FX.
4. API failures retain Error/Permission/Unavailable states instead of becoming fake zero balances.
5. Transaction explorer uses server-side pagination/filtering.
6. Confirmed internal transfers are excluded from income/expense totals.
7. Linked refunds are separated from ordinary revenue semantics and net economic expense is explicit.
8. Split category allocation uses children without also counting the parent.
9. Statement import is an in-context protected review workflow rather than a redirect loop.
10. Cash, budgets, savings, borrow/lend, recurring, notifications, saved views and preferences expose real existing backends.
11. CSP violation ingestion is rate-limited/sanitised and registered before application CSRF enforcement; CSP itself is not weakened.
12. Legacy premium banking UI is no longer globally injected into the unified Finance OS.
13. Company accountant PDF repeats company identity/report metadata/header/footer on every page.
14. Company reporting profile is editable through protected system settings.
15. Procurement master BOM startup integrity is healthy at 236 items.
16. The unified Finance Setup Centre now gives one ordered path for account creation, ownership separation, historical import, review, classification, reconciliation, receipt evidence and reusable reporting.
17. Multi-currency management conversion now uses explicit owner-scoped FX evidence and refuses to invent missing exchange rates.

18. Original requirements acceptance is now enforced by a dedicated single-Finance-OS regression contract covering the requested account, history import, Personal/Company separation, cash, Borrow/Lend, multi-currency, reporting, recovery, mobile and security workflows.

19. Banking Command Centre now surfaces permission-scoped liquidity, runway, obligations, independent approval inbox and banking attention directly inside the single Finance OS; legacy Banking test contracts now validate the canonical master frontend.

## Production infrastructure evidence

### Database transport

Current runtime evidence shows:

- active MySQL protocol TLS: **no**
- TLS capability probe: **yes**
- strict certificate verification: **not established**
- encryption-only probe cipher: `TLS_AES_128_GCM_SHA256`
- strict probe result: `HANDSHAKE_SSL_ERROR`

The application therefore does **not** claim active MySQL protocol TLS. Railway private-network traffic itself is encrypted by Railway's WireGuard mesh, but that is separate infrastructure-layer transport evidence and does not satisfy the application's MySQL-session TLS control.

Do not set `DB_TLS_REQUIRED=true` until a trusted CA/certificate path is available and a strict connection succeeds; forcing it now could take production offline.

### Backup / restore assurance

Production currently has backup-provider metadata configured but no `BACKUP_STATUS_URL`, so live backup freshness and restore-drill telemetry are not attested inside the application. The Finance system must not claim verified recoverability until:

1. a real Railway/provider backup schedule is confirmed,
2. latest successful backup telemetry is available,
3. an isolated restore drill succeeds,
4. that evidence is published to the assurance contract,
5. `BACKUP_ASSURANCE_REQUIRED=true` can pass safely.

### Outbound allowlist

`OUTBOUND_ALLOWED_HOSTS` remains empty and fail-closed. This is secure by default. Add only explicit hosts if a real backend fetch workflow requires them; never switch to allow-all.

## Remaining genuine limitations

- FX-rate storage and management conversion are implemented using explicit user-supplied evidence; automatic market-rate ingestion and accounting revaluation are intentionally not implemented.
- Receipt OCR is not configured.
- External bank payment execution is not supported.
- The standard report catalogue is now exposed through the unified Report Centre and the common branded PDF/CSV/XLSX exporter; authenticated production journey verification is still required before marking reporting READY.
- Several newly integrated UI workflows remain PARTIAL until an authenticated production user journey is exercised against real permitted records.
- MySQL-session TLS certificate trust is unresolved; do not mislabel the WireGuard private-network layer as MySQL TLS.
- Backup/restore provider telemetry is not yet connected to the application's assurance endpoint.

## Completion rule

A capability is marked READY only when backend, database, authorization, validation, audit, UI, tests and verified workflow evidence agree. Route existence or rendered HTML alone is not sufficient.
