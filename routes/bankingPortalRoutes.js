const express = require('express');
const bankingOS = require('../controllers/bankingOperatingSystemController');
const intelligence = require('../controllers/financeIntelligenceController');
const transactionIntelligence = require('../controllers/financeTransactionIntelligenceController');
const openBanking = require('../controllers/openBankingController');
const statementReview = require('../controllers/statementImportController');
const statementData = require('../controllers/statementDataManagementController');
const bankAccountLifecycle = require('../controllers/bankAccountLifecycleController');
const statementPreviewSanitizer = require('../middleware/statementPreviewSanitizer');
const financePrivacy = require('../middleware/financePrivacyMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();
const view = requireAnyPermission('VIEW_BANKING','VIEW_PERSONAL_BANKING','VIEW_BUSINESS_BANKING');
const edit = requireAnyPermission('EDIT_FINANCE');
const bankAdmin = requireAnyPermission('EDIT_BANK_DETAILS','CONNECT_BANK_ACCOUNT','MANAGE_BANK_CONNECTION');

router.use(view);
router.use(financePrivacy.resolveBankingAccessScope);

// Standalone Banking OS: does not require broad VIEW_FINANCE.
router.get('/os', bankingOS.getDashboard);
router.get('/os/capabilities', bankingOS.capabilities);
router.get('/os/command-center', bankingOS.getCommandCenter);
router.get('/os/approval-inbox', bankingOS.getApprovalInbox);
router.get('/os/cashflow-calendar', bankingOS.getCashflowCalendar);
router.get('/os/accounts/:id', bankingOS.getAccountDetail);
router.get('/os/team', bankingOS.getTeam);

router.post('/os/spaces', bankingOS.createSpace);
router.post('/os/spaces/:uid', bankingOS.updateSpace);
router.post('/os/spaces/:uid/archive', bankingOS.archiveSpace);
router.post('/os/beneficiaries', requireStepUp('CHANGE_BANK_BENEFICIARY'), bankingOS.createBeneficiary);
router.post('/os/payments', bankingOS.createPayment);
router.post('/os/payments/:uid/submit', requireStepUp('SUBMIT_BANK_PAYMENT'), bankingOS.submitPayment);
router.post('/os/payments/:uid/cancel', requireStepUp('CANCEL_BANK_PAYMENT'), bankingOS.cancelPayment);
router.post('/os/payments/:uid/decision', requireAnyPermission('APPROVE_PAYMENT'), requireStepUp('APPROVE_BANK_PAYMENT'), bankingOS.decidePayment);
router.post('/os/team/:userId/access', requireAnyPermission('EDIT_BANK_DETAILS'), requireStepUp('CHANGE_BANKING_USER_ACCESS'), bankingOS.saveTeamAccess);
router.post('/os/alerts', bankingOS.saveAlerts);

// Read-only ledger and intelligence surfaces for banking users.
router.get('/intelligence/overview', intelligence.getOverview);
router.get('/intelligence/dashboard', intelligence.getBankingDashboard);
router.get('/intelligence/transactions', intelligence.getTransactions);
router.get('/intelligence/transactions/:id', intelligence.getTransactionDetail);
router.get('/intelligence/accounts', intelligence.getAccounts);
router.post('/intelligence/accounts', bankAdmin, requireStepUp('CHANGE_BANK_DETAILS'), intelligence.saveAccount);
router.get('/intelligence/accounts/:id/lifecycle', financePrivacy.accountParam('id'), bankAccountLifecycle.getLifecycle);
router.post('/intelligence/accounts/:id/archive', bankAdmin, financePrivacy.accountParam('id'), requireStepUp('CHANGE_BANK_DETAILS'), bankAccountLifecycle.archive);
router.post('/intelligence/accounts/:id/inactive', bankAdmin, financePrivacy.accountParam('id'), requireStepUp('CHANGE_BANK_DETAILS'), bankAccountLifecycle.deactivate);
router.post('/intelligence/accounts/:id/restore', bankAdmin, financePrivacy.accountParam('id'), requireStepUp('CHANGE_BANK_DETAILS'), bankAccountLifecycle.restore);
router.delete('/intelligence/accounts/:id', bankAdmin, financePrivacy.accountParam('id'), requireStepUp('CHANGE_BANK_DETAILS'), bankAccountLifecycle.remove);
router.get('/intelligence/statements', intelligence.getStatementLibrary);
router.get('/intelligence/statements/:uid/report', financePrivacy.statementUid('uid'), intelligence.getStatementReport);
router.get('/intelligence/statements-removed', statementData.listRemoved);
router.post('/intelligence/statements/:uid/remove', edit, financePrivacy.statementUid('uid'), requireStepUp('DELETE_BANK_STATEMENT'), statementData.remove);
router.post('/intelligence/statements/:uid/restore', edit, financePrivacy.statementUid('uid'), requireStepUp('RESTORE_BANK_STATEMENT'), statementData.restore);
router.delete('/intelligence/statements/:uid/purge', bankAdmin, financePrivacy.statementUid('uid'), requireStepUp('PURGE_BANK_STATEMENT'), statementData.purge);
router.post('/intelligence/accounts/:id/clear-statements', edit, financePrivacy.accountParam('id'), requireStepUp('CLEAR_BANK_STATEMENT_HISTORY'), statementData.clearAccountStatements);
router.post('/intelligence/accounts/:id/statements/preview', edit, financePrivacy.accountParam('id'), requireStepUp('IMPORT_BANK_TRANSACTIONS'), statementPreviewSanitizer, statementReview.preview);
router.get('/intelligence/statement-reviews', financePrivacy.filterStatementList, statementReview.list);
router.get('/intelligence/statement-reviews/:uid', financePrivacy.statementUid('uid'), statementReview.get);
router.post('/intelligence/statement-reviews/:uid/rows/:rowId/select', edit, financePrivacy.statementUid('uid'), statementReview.updateRowSelection);
router.post('/intelligence/statement-reviews/:uid/rows/:rowId/override', edit, financePrivacy.statementUid('uid'), requireStepUp('IMPORT_BANK_TRANSACTIONS'), statementReview.overrideRejectedRow);
router.post('/intelligence/statement-reviews/:uid/commit', edit, financePrivacy.statementUid('uid'), requireStepUp('IMPORT_BANK_TRANSACTIONS'), statementReview.commit);
router.post('/intelligence/statement-reviews/:uid/reject', edit, financePrivacy.statementUid('uid'), requireStepUp('IMPORT_BANK_TRANSACTIONS'), statementReview.reject);
router.get('/intelligence/reports/spending', intelligence.getSpendingReport);
router.get('/intelligence/reports/portfolio-history', intelligence.getPortfolioHistoryReport);
router.get('/intelligence/statement-warehouse', intelligence.getStatementWarehouse);
router.get('/intelligence/budgets', intelligence.getBankingBudgets);
router.get('/intelligence/history-coverage', intelligence.getHistoryCoverage);
router.get('/intelligence/data-quality', intelligence.getDataQuality);
router.get('/intelligence/bank-connections', intelligence.getConnectionStatus);
router.post('/intelligence/bank-connections/connect', bankAdmin, requireStepUp('CHANGE_BANK_DETAILS'), openBanking.startConsent);
router.get('/intelligence/insights', transactionIntelligence.getInsights);
router.post('/intelligence/analyse', transactionIntelligence.runAnalysis);

// Controlled write functions remain permission gated.
router.post('/intelligence/transactions/:id', edit, intelligence.updateTransaction);
router.post('/intelligence/transactions/bulk/category', edit, intelligence.bulkCategorizeTransactions);
router.post('/intelligence/budgets', edit, intelligence.saveBankingBudget);
router.delete('/intelligence/budgets/:uid', edit, intelligence.deleteBankingBudget);

// Open Banking consent remains a privileged banking action.
router.get('/open-banking/providers', openBanking.getProviders);
router.get('/open-banking/sessions', openBanking.getSessions);
router.post('/open-banking/consent', bankAdmin, requireStepUp('CHANGE_BANK_DETAILS'), openBanking.startConsent);
router.post('/open-banking/sessions/:uid/cancel', bankAdmin, requireStepUp('CHANGE_BANK_DETAILS'), openBanking.cancelConsent);

module.exports = router;
