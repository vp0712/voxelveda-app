const express = require('express');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

router.get('/', notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.get('/preferences', notificationController.getPreferences);
router.patch('/preferences', notificationController.updatePreference);
router.post('/mark-all-read', notificationController.markAllRead);
router.delete('/read', notificationController.clearRead);
router.delete('/all', notificationController.clearAll);
router.patch('/:id/read', notificationController.markRead);
router.patch('/:id/unread', notificationController.markUnread);
router.delete('/:id', notificationController.remove);
router.post('/:id/restore', notificationController.restore);

module.exports = router;
