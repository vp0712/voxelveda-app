const express = require('express');
const trashController = require('../controllers/trashController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const router = express.Router();
const preserveArchive = (_req, res) => res.status(409).json({ code: 'ARCHIVE_RETENTION_REQUIRED', message: 'Permanent deletion is disabled. Archived records and attachments remain recoverable.' });

router.get('/', requireAnyPermission('VIEW_TRASH'), trashController.list);
router.post('/bulk-restore', requireAnyPermission('RESTORE_TRASH'), trashController.bulkRestore);
router.post('/bulk-delete', preserveArchive);
router.get('/:trashId', requireAnyPermission('VIEW_TRASH'), trashController.detail);
router.post('/:trashId/restore', requireAnyPermission('RESTORE_TRASH'), trashController.restore);
router.delete('/:trashId/permanent', preserveArchive);

module.exports = router;
