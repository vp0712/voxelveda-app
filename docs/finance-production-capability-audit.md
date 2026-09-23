# Voxel Veda Finance OS — Current Production Capability Audit

## Architecture decision

Voxel Veda has one Finance OS frontend:

- `public/finance-intelligence.html`
- `public/finance-master.js`
- `public/finance-master.css`

Backend modules remain modular under `/api/finance/*`. Legacy banking UI assets are not globally injected into Finance. No Finance V6/V7 or duplicate dashboard is part of the target architecture.

## Canonical financial truth

The canonical banking cash ledger is `bank_transactions`, with linked source/import/reconciliation/relationship records. The accounting ledger remains `finance_transactions`/journals for accounting-domain entries. Personal Money remains owner-isolated and is surfaced as a separate personal planning view; it is not silently added to company banking totals.

## Current capability inventory

| Feature | Current implementation | Classification |
|---|---|---|
| Accounts | Full account cards/workspace, history coverage, lifecycle controls, protected danger zone | READY backend / integrated UI |
| Transactions | Server pagination/filter/search, manual canonical movements, classification edit, archive/restore, source evidence | READY core / production workflow verification continues |
| Original bank evidence | Immutable `bank_transaction_original_data` separated from current classification | READY |
| Statement import | CSV/PDF/OFX/QFX/QIF/XLSX protected preview/review/duplicate/commit pipeline plus multi-file historical staging per account | READY core / integrated history centre |
| Duplicate protection | Exact row hash plus review classification | READY |
| Reconciliation | Master-UI integration over the existing reconciliation centre | READY |
| Receipts | Private secure documents, malware scan, protected download, attach/unlink | PARTIAL until production user-flow verification |
| Splits | Canonical child allocations with exact parent-total validation and no double counting | PARTIAL until production user-flow verification |
| Internal transfers | Explicit debit/credit pair relationship, same-currency validation, excluded from income/expense | PARTIAL until production user-flow verification |
| Refunds | Explicit refund-to-expense links, same-currency and remaining-balance validation, trusted-total netting | PARTIAL until production report/user-flow verification |
| Reimbursements | Draft/submit/approve/reject/payment-link lifecycle | PARTIAL until production user-flow verification |
| Cash | Canonical cash account view plus clearly separated owner-only Personal Money wallets | PARTIAL |
| Budgets | Personal budgets plus banking-ledger budgets with create/archive and usage tracking | PARTIAL |
| Savings goals | Goal management plus explicit progress contributions that do not silently move bank cash | PARTIAL |
| Borrow & Lend | Owner-only debt lifecycle and repayment workflow | PARTIAL |
| Recurring money | Personal recurring lifecycle plus finance-intelligence suggestions; no bank execution | PARTIAL |
| Categories | Original bank category preserved separately from editable system category; category manager exposed | PARTIAL |
| Rules | Suggestion-only merchant/category rules with priority | READY core |
| Insights | Evidence-backed insights linked to underlying transactions | READY core |
| Company Finance | Business-only scope, supplier/accounting command-centre data, payables/receivables surfaces | PARTIAL |
| Personal Money | Owner-only dashboards, briefing, budgets, goals, debts, recurring, saved views and planning intelligence | PARTIAL integrated |
| Consolidated | Selected permitted accounts with ownership separation | PARTIAL |
| Reports | Full standard report catalogue is exposed through one Report Centre with saved definitions and protected branded PDF/CSV/XLSX exports | PARTIAL pending authenticated production journey verification |
| Notifications | User notification centre and preferences surfaced in Finance | PARTIAL |
| User preferences | Default workspace/account/period/format/dashboard cards | PARTIAL |
| Team access | Server-side Banking/Finance permissions | READY core |
| Accounting period locking | Open/review/ready/locked transitions with protected lock workflow | READY core |
| Open Banking | Foundation/readiness/sync status only; fail-closed when provider configuration is incomplete | RUNTIME STATUS |
| Receipt OCR | No verified OCR provider | UNAVAILABLE |
| FX reporting | No trusted shared FX-rate service; native-currency separation is enforced | NOT SUPPORTED |
| Bank payment execution | Internal approval/instruction records only; no claim of external bank execution | NOT SUPPORTED |

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

- Verified FX-rate storage/conversion is not implemented.
- Receipt OCR is not configured.
- External bank payment execution is not supported.
- The standard report catalogue is now exposed through the unified Report Centre and the common branded PDF/CSV/XLSX exporter; authenticated production journey verification is still required before marking reporting READY.
- Several newly integrated UI workflows remain PARTIAL until an authenticated production user journey is exercised against real permitted records.
- MySQL-session TLS certificate trust is unresolved; do not mislabel the WireGuard private-network layer as MySQL TLS.
- Backup/restore provider telemetry is not yet connected to the application's assurance endpoint.

## Completion rule

A capability is marked READY only when backend, database, authorization, validation, audit, UI, tests and verified workflow evidence agree. Route existence or rendered HTML alone is not sufficient.
