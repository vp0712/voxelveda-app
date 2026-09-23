const STATIC_CAPABILITIES = Object.freeze({
  statement_import: { status: 'READY', source: 'statement review engine', note: 'CSV, PDF, OFX, QFX, QIF and XLSX are accepted by the protected review pipeline.' },
  statement_original_data: { status: 'READY', source: 'bank_transaction_original_data', note: 'Imported source evidence is preserved separately from current classification.' },
  transaction_edit_classification: { status: 'PARTIAL', source: 'finance intelligence', note: 'Category, ownership, normalised merchant, project, tags, GST review metadata and reviewed state are audited, permission checked and period locked; production workflow verification is still required.' },
  transaction_bulk_review: { status: 'PARTIAL', source: 'finance intelligence bulk review', note: 'Bounded all-or-nothing preview/apply supports category, ownership, merchant normalisation, project, tags, GST and reviewed state with per-record audit recovery evidence; production workflow verification is still required.' },
  transaction_archive_restore: { status: 'PARTIAL', source: 'bank_transactions archive metadata', note: 'Transactions can be logically archived and restored with preserved source evidence, audit logging and step-up on restore; production workflow verification is still required before READY.' },
  transaction_split: { status: 'PARTIAL', source: 'bank_transaction_splits', note: 'Canonical split relationships and exact-total validation are implemented; production workflow verification is still required before READY.' },
  refund_linking: { status: 'PARTIAL', source: 'finance_refund_links', note: 'Refund-to-expense linking exists with same-currency and remaining-balance validation; production report netting verification is still required.' },
  reimbursements: { status: 'PARTIAL', source: 'finance_reimbursements', note: 'Draft, submit, approve, reject, partial/full settlement and audit UI link real visible company debits with decimal-safe balance and over-allocation validation; production workflow verification is still required.' },
  receipt_storage: { status: 'PARTIAL', source: 'secure_documents + finance_receipt_requirements', note: 'Private receipt upload/list/unlink/recovery, policy-driven Missing/Requested/Not Required review, filtering, malware scanning and authenticated downloads are implemented; production workflow verification is still required.' },
  receipt_ocr: { status: 'UNAVAILABLE', note: 'No verified OCR provider is configured. Receipt values must never be silently inferred.' },
  internal_transfers: { status: 'PARTIAL', source: 'finance_transfer_links', note: 'Confirmed same-currency debit/credit pairs are represented explicitly and excluded from income/expense; production workflow verification is still required.' },
  reconciliation: { status: 'READY', source: 'finance reconciliation center', note: 'Bank transactions can be reconciled, ignored or classified with permission and audit controls.' },
  budgets: { status: 'PARTIAL', source: 'personal_money_budgets + finance banking budgets', note: 'Personal and canonical banking budget workflows are exposed in the master Finance OS, including create/archive and ledger-backed usage. End-to-end production workflow verification is still required before READY.' },
  savings_goals: { status: 'PARTIAL', source: 'personal_money_savings_goals', note: 'Savings goals and explicit goal-progress contributions are exposed in the master Finance OS. Goal progress does not silently move bank cash; production workflow verification is still required before READY.' },
  borrow_lend: { status: 'PARTIAL', source: 'personal_money_debts + personal_money_debt_payments', note: 'Owner-isolated borrow/lend records and repayment lifecycle are exposed in the master Finance OS. Consolidated reporting remains intentionally separate from company banking totals and production workflow verification is still required.' },
  recurring_money: { status: 'PARTIAL', source: 'personal_money_recurring_items + finance intelligence', note: 'Recurring records, completion workflow and intelligence suggestions are exposed in the master Finance OS. No bank payment execution is claimed; production workflow verification is still required.' },
  category_manager: { status: 'PARTIAL', source: 'finance_system_categories', note: 'Scoped Personal/Business/Both category hierarchy, archive/restore, visual metadata and GST review defaults are implemented; production workflow verification is still required before READY.' },
  category_rules: { status: 'PARTIAL', source: 'finance transaction intelligence + finance_transaction_rule_matches', note: 'Rules expose mode, GST, tags, priority, creator and match evidence. Suggest Only is the default; exact Auto Apply fills empty safe classification fields only on future reviewed statement imports in open periods. It never changes source amounts, payments, transfers or reconciliation. Production workflow verification is still required.' },
  personal_forecast_planning: { status: 'PARTIAL', source: 'Personal Money Smart/Health/Roadmaps', note: 'Safe-to-spend, health projection and roadmap intelligence are evidence-backed planning views; they never mutate the ledger and require production workflow verification before READY.' },
  cashflow_calendar: { status: 'PARTIAL', source: 'Banking OS + Personal Money Smart', note: 'Known company/banking and personal planning events are shown separately; no bank execution is claimed.' },
  user_preferences: { status: 'PARTIAL', source: 'finance_user_preferences', note: 'Per-user workspace, account, period, reporting format and dashboard-card preferences are owner-isolated and editable in the master Finance OS. Production workflow verification is still required before READY.' },
  insights: { status: 'READY', source: 'finance transaction intelligence', note: 'Insights are evidence-backed and linked to source transactions.' },
  open_banking: { status: 'RUNTIME_STATUS', note: 'Actual readiness comes from /api/finance/intelligence/banking-readiness and remains fail-closed.' },
  bank_payment_execution: { status: 'NOT_SUPPORTED', note: 'Banking payment records are approval/instruction workflows only. Voxel Veda does not claim to execute bank transfers.' },
  team_access: { status: 'READY', source: 'banking operating system', note: 'Server-side access controls exist for Banking/Finance team permissions.' },
  accounting_period_locking: { status: 'READY', source: 'finance operations', note: 'Locked periods prevent normal financial modification.' },
  statement_soft_delete_restore: { status: 'READY', source: 'statement data management', note: 'Statement removal and restore are controlled; purge requires stronger permission and step-up.' },
  account_lifecycle: { status: 'READY', source: 'bank account lifecycle', note: 'Archive, inactive, restore and protected removal workflows exist.' },
  reporting_pdf_csv: { status: 'PARTIAL', source: 'finance reports + export infrastructure', note: 'Branded accountant PDF, trial-balance CSV, permission-scoped filtered CSV/XLSX, report builder and owner-scoped saved report definitions are implemented. The full requested report catalogue and equivalent branded PDF coverage for every builder report remain incomplete.' },
  fx_reporting: { status: 'NOT_SUPPORTED', note: 'No trusted shared FX-rate service is configured. Mixed currencies must remain separate.' }
});

function financeCapabilities() {
  return {
    generated_at: new Date().toISOString(),
    rule: 'Only capabilities with working backend, authorization, validation and tested workflow may be presented as READY.',
    capabilities: STATIC_CAPABILITIES
  };
}

module.exports = { financeCapabilities, STATIC_CAPABILITIES };
