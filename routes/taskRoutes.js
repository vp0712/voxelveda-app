const express = require('express');
const router = express.Router();

const taskController = require('../controllers/taskController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

/* ================= ADMIN TASKS ================= */

router.get('/', taskController.getTasks);

router.get('/staff', taskController.getAssignableStaff);

router.get('/announcements', taskController.getAnnouncements);

router.get('/announcements/my', taskController.getMyAnnouncements);

router.get('/workhub', taskController.getStaffWorkRequests);

router.get('/workhub/my', taskController.getMyStaffWorkRequests);

router.post('/workhub', taskController.createStaffWorkRequest);

router.post('/workhub/update', requireInputPermission('tasks_input'), taskController.updateStaffWorkRequest);

router.post('/workhub/delete', requireInputPermission('tasks_input'), taskController.deleteStaffWorkRequest);
router.get('/messages', taskController.getStaffMessages);

router.get('/messages/my', taskController.getMyStaffMessages);

router.post('/messages', taskController.createStaffMessage);

router.post('/messages/update', requireInputPermission('tasks_input'), taskController.updateStaffMessage);

router.post('/messages/delete', requireInputPermission('tasks_input'), taskController.deleteStaffMessage);

router.post('/announcements', requireInputPermission('tasks_input'), taskController.createAnnouncement);

router.post('/announcements/update', requireInputPermission('tasks_input'), taskController.updateAnnouncement);

router.post('/announcements/delete', requireInputPermission('tasks_input'), taskController.deleteAnnouncement);

router.post('/', requireAnyPermission('MANAGE_JOBS', 'MANAGE_TEAM_JOBS'), taskController.createTask);

router.post('/update', requireAnyPermission('MANAGE_JOBS', 'MANAGE_TEAM_JOBS'), taskController.updateTask);

router.post('/delete', requireAnyPermission('MANAGE_JOBS', 'MANAGE_TEAM_JOBS'), taskController.deleteTask);

/* ================= SHARED TASK STATUS ================= */
/* Admin and assigned staff can update task status */

router.post('/status', taskController.updateTaskStatus);

/* ================= STAFF TASKS ================= */

router.get('/my', taskController.getMyTasks);

module.exports = router;
