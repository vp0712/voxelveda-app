const express = require('express');
const controller = require('../controllers/highRiskFinanceController');
const operations = require('../controllers/financeOperationsController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();

router.get('/suppliers/:subjectId/bank-details', requireAnyPermission('VIEW_BANKING'), (req, res, next) => { req.params.subjectType = 'SUPPLIER'; next(); }, controller.getBankDetailSummary);
router.post('/suppliers/:subjectId/bank-details/change-requests', requireAnyPermission('EDIT_BANK_DETAILS'), requireStepUp('CHANGE_SUPPLIER_BANK_DETAILS'), (req, res, next) => { req.params.subjectType = 'SUPPLIER'; next(); }, controller.requestBankDetailChange);
router.post('/suppliers/:subjectId/bank-details/reveal', requireAnyPermission('VIEW_BANK_DETAILS'), requireStepUp('REVEAL_SUPPLIER_BANK_DETAILS'), (req, res, next) => { req.params.subjectType = 'SUPPLIER'; next(); }, controller.revealBankDetails);

router.get('/employees/:subjectId/bank-details', requireAnyPermission('VIEW_PAYROLL_BANKING'), (req, res, next) => { req.params.subjectType = 'EMPLOYEE'; next(); }, controller.getBankDetailSummary);
router.post('/employees/:subjectId/bank-details/change-requests', requireAnyPermission('EDIT_PAYROLL'), requireStepUp('CHANGE_PAYROLL_BANK_DETAILS'), (req, res, next) => { req.params.subjectType = 'EMPLOYEE'; next(); }, controller.requestBankDetailChange);
router.post('/employees/:subjectId/bank-details/reveal', requireAnyPermission('VIEW_PAYROLL_BANKING'), requireStepUp('REVEAL_PAYROLL_BANK_DETAILS'), (req, res, next) => { req.params.subjectType = 'EMPLOYEE'; next(); }, controller.revealBankDetails);

router.get('/approvals', requireAnyPermission('APPROVE_PAYMENT', 'APPROVE_PAYROLL_BANK_CHANGE', 'POST_TRANSACTION'), controller.listApprovalQueue);
router.post('/bank-detail-change-requests/:id/review', requireAnyPermission('APPROVE_PAYMENT', 'APPROVE_PAYROLL_BANK_CHANGE'), requireStepUp('APPROVE_BANK_DETAIL_CHANGE'), controller.reviewBankDetailChange);
router.post('/payment-approvals/:id/review', requireAnyPermission('APPROVE_PAYMENT'), requireStepUp('APPROVE_HIGH_VALUE_PAYMENT'), controller.reviewPaymentApproval);
router.post('/payment-approvals/:id/execute', requireAnyPermission('POST_TRANSACTION'), requireStepUp('EXECUTE_APPROVED_PAYMENT'), controller.prepareApprovedPayment, operations.recordSupplierPayment);

module.exports = router;
