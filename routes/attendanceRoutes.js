const express = require('express');
const router = express.Router();

const attendanceController = require('../controllers/attendanceController');
const timesheetWorkflowController = require('../controllers/timesheetWorkflowController');
const auth = require('../middleware/auth'); // IMPORTANT
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

/* ================= STAFF ATTENDANCE ================= */

router.get('/shift-qr', auth, attendanceController.shiftQrToken);

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
router.get('/timesheets', auth, timesheetWorkflowController.list);

router.get('/timesheets/user', auth, attendanceController.userTimesheets);
router.post('/timesheets/send', auth, requireInputPermission('attendance_input'), attendanceController.sendTimesheetSummary);
router.get('/timesheets/payroll-ready', auth, timesheetWorkflowController.payrollReady);
router.get('/timesheets/:id', auth, timesheetWorkflowController.detail);
router.post('/timesheets/:id/submit', auth, timesheetWorkflowController.submit);
router.post('/timesheets/:id/approve', auth, timesheetWorkflowController.approve);
router.post('/timesheets/:id/reject', auth, timesheetWorkflowController.reject);
router.post('/timesheets/:id/correction', auth, timesheetWorkflowController.requestCorrection);
router.post('/timesheets/:id/amend', auth, timesheetWorkflowController.amend);
router.post('/timesheets/status', auth, timesheetWorkflowController.legacyStatus);

router.post('/admin/save', auth, requireInputPermission('attendance_input'), attendanceController.saveAttendance);

router.post('/admin/delete', auth, requireInputPermission('attendance_input'), attendanceController.deleteAttendance);

module.exports = router;
