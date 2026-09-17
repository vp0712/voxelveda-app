const express = require('express');
const controller = require('../controllers/advancedBankingController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();
const view = requireAnyPermission('VIEW_BANKING', 'VIEW_PERSONAL_BANKING', 'VIEW_BUSINESS_BANKING');
const connect = requireAnyPermission('CONNECT_BANK_ACCOUNT', 'EDIT_BANK_DETAILS');
const sync = requireAnyPermission('SYNC_BANK_ACCOUNT', 'EDIT_FINANCE');
const manage = requireAnyPermission('MANAGE_BANK_CONNECTION', 'EDIT_BANK_DETAILS');

router.get('/status', view, controller.status);
router.get('/connections', view, controller.connections);
router.get('/consents', view, controller.consentCenter);
router.get('/sync-jobs', view, controller.syncJobs);
router.get('/data-quality', view, controller.dataQuality);
router.get('/accounts/:id/transactions', view, controller.transactions);
router.post('/sync', sync, controller.sync);
router.post('/connections/:uid/sync', sync, controller.sync);
router.post('/connections/:uid/reauthorize', connect, requireStepUp('CHANGE_BANK_DETAILS'), controller.reauthorize);
router.post('/connections/:uid/archive', manage, requireStepUp('CHANGE_BANK_DETAILS'), controller.archive);
router.post('/connections/:uid/disconnect', manage, requireStepUp('CHANGE_BANK_DETAILS'), controller.disconnect);

module.exports = router;
