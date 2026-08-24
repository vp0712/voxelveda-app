const express = require('express');
const controller = require('../controllers/financeController');
const operations = require('../controllers/financeOperationsController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');

const router = express.Router();

router.get('/overview', controller.getOverview);
router.get('/financial-years', controller.getFinancialYears);
router.post('/financial-years/:id/check', requireInputPermission('finance_input'), controller.runYearEndCheck);
router.post('/financial-years/:id/status', requireInputPermission('finance_lock_period'), controller.updateFinancialYearStatus);
router.get('/issues', controller.getIssues);
router.post('/issues/:id', requireInputPermission('finance_input'), controller.updateIssue);
router.get('/setup', controller.getSetup);
router.post('/setup', requireInputPermission('finance_setup'), controller.updateSetup);
router.get('/transactions', controller.getTransactions);
router.get('/transactions/:id', controller.getTransaction);
router.post('/transactions', requireInputPermission('finance_input'), controller.saveTransaction);
router.post('/transactions/:id/post', requireInputPermission('finance_post_transaction'), controller.postTransaction);
router.post('/transactions/:id/void', requireInputPermission('finance_void'), controller.voidTransaction);
router.get('/journals', controller.getJournals);
router.post('/journals', requireInputPermission('finance_create_journal'), controller.createJournal);
router.get('/reports', controller.getReports);
router.get('/exports/trial-balance.csv', requirePermission('finance_export'), controller.downloadTrialBalanceCsv);
router.get('/exports/accountant-review.pdf', requirePermission('finance_export'), controller.downloadAccountantPdf);

router.get('/supplier-bills', operations.getSupplierBills);
router.get('/supplier-bills/:id', operations.getSupplierBill);
router.post('/supplier-bills', requireInputPermission('finance_input'), operations.saveSupplierBill);
router.post('/supplier-bills/:id/status', requireInputPermission((req) => (
  String(req.body.status || '').toUpperCase() === 'VOID' ? 'finance_void' : 'finance_post_transaction'
)), operations.updateSupplierBillStatus);
router.post('/supplier-bills/:id/payments', requireInputPermission('finance_input'), operations.recordSupplierPayment);

router.get('/bank-accounts', operations.getBankAccounts);
router.post('/bank-accounts', requireInputPermission('finance_reconcile'), operations.saveBankAccount);
router.get('/bank-accounts/:id/transactions', operations.getBankTransactions);
router.post('/bank-accounts/:id/import', requireInputPermission('finance_reconcile'), operations.importBankTransactions);
router.post('/bank-transactions/:id/reconcile', requireInputPermission('finance_reconcile'), operations.reconcileBankTransaction);
router.post('/bank-transactions/:id/ignore', requireInputPermission('finance_reconcile'), operations.ignoreBankTransaction);

router.get('/accounting-periods', operations.getAccountingPeriods);
router.post('/accounting-periods/:id/status', requireInputPermission('finance_lock_period'), operations.updateAccountingPeriod);
router.get('/accountant-queries', operations.getAccountantQueries);
router.post('/accountant-queries', requireInputPermission('finance_input'), operations.saveAccountantQuery);
router.post('/accountant-queries/:id', requireInputPermission('finance_input'), operations.updateAccountantQuery);
router.get('/assets', operations.getAssets);
router.post('/assets', requireInputPermission('finance_input'), operations.saveAsset);

module.exports = router;
