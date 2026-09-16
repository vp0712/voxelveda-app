const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const controller = read('controllers/personalMoneyReviewController.js');
const routes = read('routes/financeRoutes.js');
const ui = read('public/personal-money-review.js');
const html = read('public/finance-intelligence.html');
const migration = read('migrations/20260916_personal_money_review_inbox.sql');

assert(controller.includes("ba.created_by=? AND ba.ownership_scope='PERSONAL'"), 'Review Inbox must scope bank accounts to the current user and PERSONAL ownership.');
assert(controller.includes("bt.ownership_scope='PERSONAL'"), 'Review Inbox must scope transactions to PERSONAL ownership.');
assert(controller.includes('bt.is_internal_transfer=0'), 'Internal transfers must not be matched to recurring spending.');
assert(controller.includes('score.confidence<70') || controller.includes('score.confidence < 70'), 'Confirm must re-check the safe confidence threshold on the server.');
assert(controller.includes("decision='CONFIRMED'"), 'Confirmed match decisions must be recorded.');
assert(controller.includes('bank_transaction_id=?') && controller.includes('already been confirmed against another recurring item'), 'A bank transaction must not be confirmed against multiple recurring items.');
assert(controller.includes('const updateAmount=Boolean(req.body?.update_amount)'), 'Changing the future recurring amount must require an explicit request.');
assert(controller.includes("updateAmount?',amount=?':''"), 'Recurring amount changes must be conditional on explicit update_amount approval.');
assert(controller.includes('No company accounting entry was created'), 'Confirm response must state that company accounting is not changed.');
assert(!controller.includes('INSERT INTO finance_transactions'), 'Personal review must never create company finance transactions.');
assert(!controller.includes('INSERT INTO journal_entries'), 'Personal review must never create journal entries.');
assert(!controller.includes('DELETE FROM bank_transactions'), 'Duplicate detection must never auto-delete bank transactions.');
assert(controller.includes('duplicate_candidates'), 'Review Inbox must expose duplicate-looking transactions as review candidates.');

assert(routes.includes("router.get('/personal-money/review-inbox', requireAnyPermission('VIEW_BANKING')"), 'Review Inbox GET route must require banking view permission.');
assert(routes.includes("router.post('/personal-money/review-inbox/:recurringId/:transactionId/confirm', requireAnyPermission('EDIT_FINANCE')"), 'Confirm route must require finance edit permission.');
assert(routes.includes("router.post('/personal-money/review-inbox/:recurringId/:transactionId/dismiss', requireAnyPermission('EDIT_FINANCE')"), 'Dismiss route must require finance edit permission.');

assert(ui.includes('Confirm match'), 'UI must expose an explicit confirm action.');
assert(ui.includes('Confirm + use'), 'UI must expose a separate explicit future-amount update action.');
assert(ui.includes('Not this payment'), 'UI must allow dismissing a wrong match.');
assert(ui.includes('nothing deleted') || ui.includes('never delete'), 'UI must explain duplicate warnings are non-destructive.');
assert(ui.includes('window.confirm'), 'UI must confirm before applying a suggested transaction match.');
assert(html.includes('/personal-money-review.js?v=20260916-review-inbox'), 'Finance Intelligence must load the Smart Review Inbox UI.');

assert(migration.includes('personal_money_recurring_matches'), 'Review Inbox migration must create the match ledger.');
assert(migration.includes('UNIQUE KEY uq_personal_recurring_match_transaction'), 'Match ledger must prevent duplicate pair decisions.');
assert(migration.includes('user_id'), 'Match decisions must remain owner-scoped.');

console.log('Personal Money Smart Review Inbox regression checks passed.');
