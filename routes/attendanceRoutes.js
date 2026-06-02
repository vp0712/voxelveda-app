const express = require('express');
const router = express.Router();

const attendanceController = require('../controllers/attendanceController');
const auth = require('../middleware/auth'); // IMPORTANT
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

/* ================= STAFF ATTENDANCE ================= */

// Must be logged in
router.post('/clock-in', auth, requireInputPermission('attendance_input'), attendanceController.clockIn);

router.post('/clock-out', auth, requireInputPermission('attendance_input'), attendanceController.clockOut);

router.get('/today', auth, attendanceController.todayAttendance);

router.get('/week', auth, attendanceController.weekAttendance);

router.get('/my', auth, attendanceController.myAttendance);

/* ================= ADMIN ATTENDANCE ================= */

// Admin only (controller will validate role)
router.get('/all', auth, attendanceController.allAttendance);

// NEW: Weekly timesheets (admin overview)
router.get('/timesheets', auth, attendanceController.allWeeklyTimesheets);

router.get('/timesheets/user', auth, attendanceController.userTimesheets);

router.post('/admin/save', auth, requireInputPermission('attendance_input'), attendanceController.saveAttendance);

router.post('/admin/delete', auth, requireInputPermission('attendance_input'), attendanceController.deleteAttendance);

module.exports = router;
