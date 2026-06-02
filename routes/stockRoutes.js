const express = require('express');
const stockController = require('../controllers/stockController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

const router = express.Router();

router.get('/', stockController.getStock);
router.post('/', requireInputPermission('stock_in_input'), stockController.saveStock);
router.get('/movements', stockController.getStockMovements);
router.post('/issue', requireInputPermission('stock_out_input'), stockController.issueStock);
router.post('/movement/update', requireInputPermission(['stock_in_input', 'stock_out_input']), stockController.updateStockMovement);
router.post('/movement/delete', requireInputPermission(['stock_in_input', 'stock_out_input']), stockController.deleteStockMovement);
router.post('/delete', requireInputPermission('stock_in_input'), stockController.deleteStock);

module.exports = router;
