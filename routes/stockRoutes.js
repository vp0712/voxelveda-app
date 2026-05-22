const express = require('express');
const stockController = require('../controllers/stockController');

const router = express.Router();

router.get('/', stockController.getStock);
router.post('/', stockController.saveStock);
router.get('/movements', stockController.getStockMovements);
router.post('/issue', stockController.issueStock);
router.post('/movement/update', stockController.updateStockMovement);
router.post('/movement/delete', stockController.deleteStockMovement);
router.post('/delete', stockController.deleteStock);

module.exports = router;
