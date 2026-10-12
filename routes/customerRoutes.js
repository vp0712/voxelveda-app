const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

router.get('/', requireAnyPermission('VIEW_CUSTOMERS', 'EDIT_CUSTOMERS'), customerController.getCustomers);
router.post('/', requireAnyPermission('EDIT_CUSTOMERS'), customerController.saveCustomer);
router.post('/delete', requireAnyPermission('EDIT_CUSTOMERS'), customerController.deleteCustomer);

module.exports = router;
