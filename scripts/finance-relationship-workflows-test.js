'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const migration = read('migrations/20260923_finance_relationship_workflows.sql');
const relationships = read('controllers/financeRelationshipController.js');
const receipts = read('controllers/financeReceiptController.js');
const routes = read('routes/financeRoutes.js');
const privacy = read('middleware/financePrivacyMiddleware.js');
const client = read('public/finance-master.js');
const capabilities = read('services/financeCapabilityRegistry.js');
const uploads = read('middleware/uploadSecurity.js');

for (const table of [
  'finance_transfer_links',
  'bank_transaction_splits',
  'finance_refund_links',
  'finance_reimbursements',
  'finance_reimbursement_payments'
]) assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `relationship migration missing ${table}`);

for (const marker of [
  'exports.getSplits',
  'exports.replaceSplits',
  'SPLIT_TOTAL_MISMATCH',
  'exports.linkRefund',
  'REFUND_FX_EVIDENCE_REQUIRED',
  'exports.createReimbursement',
  'exports.transitionReimbursement',
  'exports.addReimbursementPayment',
  'exports.linkTransfer',
  'TRANSFER_FX_EVIDENCE_REQUIRED',
  'TRANSFER_AMOUNT_MISMATCH',
  'is_internal_transfer=1'
]) assert(relationships.includes(marker), `Finance relationship workflow missing ${marker}`);

assert(relationships.includes('money.toCents'), 'relationship money validation must use decimal-safe money utilities');
assert(relationships.includes('privacy.assertBankTransactionAccess'), 'relationship workflows must enforce bank-transaction privacy');

for (const route of [
  '/bank-transactions/:id/transfer-links',
  '/bank-transactions/:id/splits',
  '/bank-transactions/:id/refund-links',
  '/reimbursements',
  '/bank-transactions/:id/receipts'
]) assert(routes.includes(route), `Finance route missing ${route}`);

assert(routes.includes("financePrivacy.bankTransactionParam('id')"), 'transaction relationship routes must keep server-side privacy guards');
assert(routes.includes("requireStepUp('APPROVE_REIMBURSEMENT')"), 'reimbursement approval must require step-up');
assert(routes.includes('validateUploadedFile'), 'receipt upload must retain secure file validation');
assert(receipts.includes('registerDocument'), 'receipts must reuse protected document storage');
assert(receipts.includes('FINANCE_RECEIPT_ATTACHED'), 'receipt attachment must be audited');
assert(receipts.includes('deleted_at'), 'receipt unlink must use soft-delete semantics');
assert(uploads.includes("['.heic'"), 'HEIC receipt upload support is missing');
assert(privacy.includes('assertBankTransactionAccess'), 'finance privacy middleware lost transaction isolation');

for (const marker of [
  'receiptUploadForm',
  'Transfers',
  'Refunds',
  'Reimbursements',
  'relationship-candidates/transfers',
  'relationship-candidates/refunds'
]) assert(client.includes(marker), `Finance master UI missing ${marker}`);

assert(capabilities.includes("transaction_split: { status: 'PARTIAL'"), 'split capability must remain partial until production verification');
assert(capabilities.includes("refund_linking: { status: 'PARTIAL'"), 'refund capability must remain partial until production verification');
assert(capabilities.includes("reimbursements: { status: 'PARTIAL'"), 'reimbursement capability must remain partial until production verification');
assert(capabilities.includes("receipt_storage: { status: 'PARTIAL'"), 'receipt capability must remain partial until production verification');
assert(capabilities.includes("internal_transfers: { status: 'PARTIAL'"), 'transfer capability must remain partial until production verification');

console.log('Finance relationship and receipt workflow regression checks passed.');
