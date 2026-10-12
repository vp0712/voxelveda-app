const express = require('express');
const router = express.Router();
const materialController = require('../controllers/materialController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

function materialInputPermission(req) {
  const type = String(req.body.inventory_type || req.query.inventory_type || '').toLowerCase();
  return type === 'packaging' ? 'packaging_input' : 'raw_material_input';
}

router.get('/', requireAnyPermission('VIEW_INVENTORY', 'EDIT_INVENTORY'), materialController.getMaterials);
router.get('/:id/process-sheet.pdf', requireAnyPermission('VIEW_INVENTORY', 'EDIT_INVENTORY'), materialController.viewProcessSheetPdf);
router.get('/:id/movements', requireAnyPermission('VIEW_INVENTORY', 'EDIT_INVENTORY'), materialController.getMaterialMovements);
router.post('/', requireInputPermission(materialInputPermission), materialController.saveMaterial);
router.post('/delete', requireInputPermission(materialInputPermission), materialController.deleteMaterial);
router.post('/restore', requireInputPermission(materialInputPermission), materialController.restoreMaterial);

module.exports = router;
