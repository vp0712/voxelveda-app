const express = require('express');
const router = express.Router();

const taskController = require('../controllers/taskController');

/* ================= ADMIN TASKS ================= */

router.get('/', taskController.getTasks);

router.get('/announcements', taskController.getAnnouncements);

router.get('/announcements/my', taskController.getMyAnnouncements);

router.post('/announcements', taskController.createAnnouncement);

router.post('/announcements/delete', taskController.deleteAnnouncement);

router.post('/', taskController.createTask);

router.post('/delete', taskController.deleteTask);

/* ================= SHARED TASK STATUS ================= */
/* Admin and assigned staff can update task status */

router.post('/status', taskController.updateTaskStatus);

/* ================= STAFF TASKS ================= */

router.get('/my', taskController.getMyTasks);

module.exports = router;
