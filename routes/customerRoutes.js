const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

router.get('/', customerController.getCustomers);
router.post('/', customerController.saveCustomer);
router.post('/delete', customerController.deleteCustomer);

module.exports = router;
