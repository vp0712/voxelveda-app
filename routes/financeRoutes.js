const express = require('express');
const controller = require('../controllers/financeController');
const operations = require('../controllers/financeOperationsController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const requirePermission = require('../middleware/permissionMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const router = express.Router();

router.get('/overview', controller.getOverview);
router.get('/financial-years', controller.getFinancialYears);
router.post('/financial-years/:id/check', requireAnyPermission('EDIT_FINANCE'), controller.runYearEndCheck);
router.post('/financial-years/:id/status', requireAnyPermission('EDIT_FINANCE'), controller.updateFinancialYearStatus);
router.get('/issues', controller.getIssues);
router.post('/issues/:id', requireAnyPermission('EDIT_FINANCE'), controller.updateIssue);
router.get('/setup', controller.getSetup);
router.post('/setup', requireAnyPermission('EDIT_FINANCE'), controller.updateSetup);
router.get('/transactions', controller.getTransactions);
router.get('/transactions/:id', controller.getTransaction);
router.post('/transactions', requireAnyPermission('EDIT_FINANCE'), controller.saveTransaction);
router.post('/transactions/:id/post', requireAnyPermission('POST_TRANSACTION'), controller.postTransaction);
router.post('/transactions/:id/void', requireAnyPermission('VOID_TRANSACTION'), controller.voidTransaction);
router.get('/journals', controller.getJournals);
router.post('/journals', requireAnyPermission('EDIT_FINANCE'), controller.createJournal);
router.get('/reports', controller.getReports);
router.get('/exports/trial-balance.csv', requirePermission('EXPORT_FINANCIAL_DATA'), controller.downloadTrialBalanceCsv);
router.get('/exports/accountant-review.pdf', requirePermission('EXPORT_FINANCIAL_DATA'), controller.downloadAccountantPdf);

router.get('/supplier-bills', operations.getSupplierBills);
router.get('/supplier-bills/:id', operations.getSupplierBill);
router.post('/supplier-bills', requireAnyPermission('EDIT_FINANCE'), operations.saveSupplierBill);
router.post('/supplier-bills/:id/status', requireInputPermission((req) => (
  String(req.body.status || '').toUpperCase() === 'VOID' ? 'VOID_TRANSACTION' : 'POST_TRANSACTION'
)), operations.updateSupplierBillStatus);
router.post('/supplier-bills/:id/payments', requireAnyPermission('POST_TRANSACTION'), operations.recordSupplierPayment);

router.get('/bank-accounts', requireAnyPermission('VIEW_BANKING'), operations.getBankAccounts);
router.post('/bank-accounts', requireAnyPermission('EDIT_BANK_DETAILS'), operations.saveBankAccount);
router.get('/bank-accounts/:id/transactions', requireAnyPermission('VIEW_BANKING'), operations.getBankTransactions);
router.post('/bank-accounts/:id/import', requireAnyPermission('EDIT_FINANCE'), operations.importBankTransactions);
router.post('/bank-transactions/:id/reconcile', requireAnyPermission('EDIT_FINANCE'), operations.reconcileBankTransaction);
router.post('/bank-transactions/:id/ignore', requireAnyPermission('EDIT_FINANCE'), operations.ignoreBankTransaction);

router.get('/accounting-periods', operations.getAccountingPeriods);
router.post('/accounting-periods/:id/status', requireAnyPermission('EDIT_FINANCE'), operations.updateAccountingPeriod);
router.get('/accountant-queries', operations.getAccountantQueries);
router.post('/accountant-queries', requireAnyPermission('EDIT_FINANCE'), operations.saveAccountantQuery);
router.post('/accountant-queries/:id', requireAnyPermission('EDIT_FINANCE'), operations.updateAccountantQuery);
router.get('/assets', operations.getAssets);
router.post('/assets', requireAnyPermission('EDIT_FINANCE'), operations.saveAsset);

module.exports = router;
