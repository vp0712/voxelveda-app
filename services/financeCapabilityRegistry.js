const STATIC_CAPABILITIES = Object.freeze({
  statement_import: { status: 'READY', source: 'statement review engine', note: 'CSV, PDF, OFX, QFX, QIF and XLSX are accepted by the protected review pipeline.' },
  statement_original_data: { status: 'READY', source: 'bank_transaction_original_data', note: 'Imported source evidence is preserved separately from current classification.' },
  transaction_edit_classification: { status: 'READY', source: 'finance intelligence', note: 'Category and allowed ownership changes are audited and permission checked.' },
  transaction_split: { status: 'PARTIAL', source: 'bank_transaction_splits', note: 'Canonical split relationships and exact-total validation are implemented; production workflow verification is still required before READY.' },
  refund_linking: { status: 'PARTIAL', source: 'finance_refund_links', note: 'Refund-to-expense linking exists with same-currency and remaining-balance validation; production report netting verification is still required.' },
  reimbursements: { status: 'PARTIAL', source: 'finance_reimbursements', note: 'Draft, submit, approve, reject and payment-link lifecycle exists; production verification is still required.' },
  receipt_storage: { status: 'PARTIAL', source: 'secure_documents', note: 'Private receipt upload/list/unlink is integrated with Finance privacy, malware scanning and protected downloads; production workflow verification is still required.' },
  receipt_ocr: { status: 'UNAVAILABLE', note: 'No verified OCR provider is configured. Receipt values must never be silently inferred.' },
  internal_transfers: { status: 'PARTIAL', source: 'finance_transfer_links', note: 'Confirmed same-currency debit/credit pairs are represented explicitly and excluded from income/expense; production workflow verification is still required.' },
  reconciliation: { status: 'READY', source: 'finance reconciliation center', note: 'Bank transactions can be reconciled, ignored or classified with permission and audit controls.' },
  budgets: { status: 'PARTIAL', note: 'Personal and banking budget backends exist; master UI and canonical reporting still require consolidation.' },
  savings_goals: { status: 'PARTIAL', note: 'Personal savings goal tracking exists; contributions do not automatically move ledger money.' },
  borrow_lend: { status: 'PARTIAL', note: 'Personal debt/payment lifecycle exists and is owner isolated; canonical consolidated reporting is still being aligned.' },
  recurring_money: { status: 'PARTIAL', note: 'Personal recurring items and intelligence suggestions exist; no payment execution occurs.' },
  category_rules: { status: 'READY', source: 'finance transaction intelligence', note: 'Rules create suggestions and never silently post or reconcile transactions.' },
  insights: { status: 'READY', source: 'finance transaction intelligence', note: 'Insights are evidence-backed and linked to source transactions.' },
  open_banking: { status: 'RUNTIME_STATUS', note: 'Actual readiness comes from /api/finance/intelligence/banking-readiness and remains fail-closed.' },
  bank_payment_execution: { status: 'NOT_SUPPORTED', note: 'Banking payment records are approval/instruction workflows only. Voxel Veda does not claim to execute bank transfers.' },
  team_access: { status: 'READY', source: 'banking operating system', note: 'Server-side access controls exist for Banking/Finance team permissions.' },
  accounting_period_locking: { status: 'READY', source: 'finance operations', note: 'Locked periods prevent normal financial modification.' },
  statement_soft_delete_restore: { status: 'READY', source: 'statement data management', note: 'Statement removal and restore are controlled; purge requires stronger permission and step-up.' },
  account_lifecycle: { status: 'READY', source: 'bank account lifecycle', note: 'Archive, inactive, restore and protected removal workflows exist.' },
  reporting_pdf_csv: { status: 'PARTIAL', note: 'Accountant PDF and trial-balance CSV exist; full report builder and XLSX coverage are not complete.' },
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
