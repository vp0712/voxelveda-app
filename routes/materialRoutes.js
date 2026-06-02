const express = require('express');
const router = express.Router();
const materialController = require('../controllers/materialController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

function materialInputPermission(req) {
  const type = String(req.body.inventory_type || req.query.inventory_type || '').toLowerCase();
  return type === 'packaging' ? 'packaging_input' : 'raw_material_input';
}

router.get('/', materialController.getMaterials);
router.get('/:id/process-sheet.pdf', materialController.viewProcessSheetPdf);
router.post('/', requireInputPermission(materialInputPermission), materialController.saveMaterial);
router.post('/delete', requireInputPermission(materialInputPermission), materialController.deleteMaterial);

module.exports = router;
