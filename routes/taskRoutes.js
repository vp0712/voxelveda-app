const express = require('express');
const router = express.Router();

const taskController = require('../controllers/taskController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

/* ================= ADMIN TASKS ================= */

router.get('/', taskController.getTasks);

router.get('/staff', taskController.getAssignableStaff);

router.get('/announcements', taskController.getAnnouncements);

router.get('/announcements/my', taskController.getMyAnnouncements);

router.post('/announcements', requireInputPermission('tasks_input'), taskController.createAnnouncement);

router.post('/announcements/update', requireInputPermission('tasks_input'), taskController.updateAnnouncement);

router.post('/announcements/delete', requireInputPermission('tasks_input'), taskController.deleteAnnouncement);

router.post('/', requireInputPermission('tasks_input'), taskController.createTask);

router.post('/update', requireInputPermission('tasks_input'), taskController.updateTask);

router.post('/delete', requireInputPermission('tasks_input'), taskController.deleteTask);

/* ================= SHARED TASK STATUS ================= */
/* Admin and assigned staff can update task status */

router.post('/status', taskController.updateTaskStatus);

/* ================= STAFF TASKS ================= */

router.get('/my', taskController.getMyTasks);

module.exports = router;
