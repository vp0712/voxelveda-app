const express = require('express');
const trashController = require('../controllers/trashController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();

router.get('/', requireAnyPermission('VIEW_TRASH'), trashController.list);
router.post('/bulk-restore', requireAnyPermission('RESTORE_TRASH'), trashController.bulkRestore);
router.post('/bulk-delete', requireAnyPermission('MANAGE_TRASH'), requireStepUp('PERMANENT_DELETE'), trashController.bulkDelete);
router.get('/:trashId', requireAnyPermission('VIEW_TRASH'), trashController.detail);
router.post('/:trashId/restore', requireAnyPermission('RESTORE_TRASH'), trashController.restore);
router.delete('/:trashId/permanent', requireAnyPermission('MANAGE_TRASH'), requireStepUp('PERMANENT_DELETE'), trashController.permanentDelete);

module.exports = router;
