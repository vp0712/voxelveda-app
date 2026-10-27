const express = require('express');
const router = express.Router();

const attendanceController = require('../controllers/attendanceController');
const timesheetWorkflowController = require('../controllers/timesheetWorkflowController');
const weeklyDeliveryController = require('../controllers/weeklyTimesheetDeliveryController');
const auth = require('../middleware/auth'); // IMPORTANT
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

/* ================= STAFF ATTENDANCE ================= */

router.get('/shift-qr', auth, attendanceController.shiftQrToken);
const attend = requireAnyPermission('VIEW_ATTENDANCE');
const actionFields = ['request_id','action','attendance_id','qr_proof','shift_qr_token','task_id','category_id','category','notes'];
router.post('/qr/validate', auth, attend, bodyContract(['token','action','attendance_id'],{required:['token','action']}), attendanceController.validateQr);
router.post('/actions', auth, attend, bodyContract(actionFields,{required:['request_id','action']}), attendanceController.action);
router.get('/reconcile', auth, attend, attendanceController.reconcile);
router.get('/sessions/:id/summary-options', auth, attend, attendanceController.checkoutSummaryOptions);
router.post('/sessions/:id/note', auth, attend, bodyContract(['request_id','expected_revision','task_id','category_id','category','notes'],{required:['request_id','expected_revision']}), attendanceController.saveCheckoutNote);
router.get('/corrections', auth, attend, attendanceController.listCorrections);
router.get('/corrections/:id', auth, attend, attendanceController.correctionDetail);
router.post('/corrections', auth, attend, bodyContract(['request_id','correction_type','attendance_id','expected_revision','clock_in','clock_out','break_minutes','notes','reason'],{required:['request_id','clock_in','reason']}), attendanceController.requestCorrection);
const reviewCorrections = requireAnyPermission('EDIT_ATTENDANCE','APPROVE_TEAM_TIMESHEET','APPROVE_ALL_TIMESHEETS');
router.post('/corrections/:id/approve', auth, attend, reviewCorrections, bodyContract(['expected_revision','reason'],{required:['expected_revision','reason']}), attendanceController.approveCorrection);
router.post('/corrections/:id/reject', auth, attend, reviewCorrections, bodyContract(['expected_revision','reason'],{required:['expected_revision','reason']}), attendanceController.rejectCorrection);

// Must be logged in
router.post('/clock-in', auth, attend, bodyContract(actionFields,{required:['request_id']}), attendanceController.clockIn);

router.post('/clock-out', auth, attend, bodyContract(actionFields,{required:['request_id','attendance_id']}), attendanceController.clockOut);

router.get('/today', auth, attend, attendanceController.todayAttendance);

router.get('/week', auth, requireAnyPermission('VIEW_ATTENDANCE','VIEW_OWN_TIMESHEET'), attendanceController.weekAttendance);

router.get('/my', auth, attend, attendanceController.myAttendance);
router.get('/sessions', auth, attend, attendanceController.sessions);
router.get('/team', auth, attend, attendanceController.team);

/* ================= ADMIN ATTENDANCE ================= */

// Admin only (controller will validate role)
router.get('/all', auth, attendanceController.allAttendance);

// NEW: Weekly timesheets (admin overview)
router.get('/timesheets', auth, timesheetWorkflowController.list);

router.get('/timesheets/user', auth, attendanceController.userTimesheets);
router.post('/timesheets/send', auth, weeklyDeliveryController.legacySend);
router.get('/timesheets/weekly-reconciliation', auth, weeklyDeliveryController.reconciliation);
router.get('/timesheets/weekly-deliveries', auth, weeklyDeliveryController.list);
router.get('/timesheets/weekly-deliveries/:id', auth, weeklyDeliveryController.detail);
router.post('/timesheets/weekly-deliveries/:id/revision', auth, weeklyDeliveryController.revise);
router.post('/timesheets/weekly-deliveries/:id/retry-generation', auth, weeklyDeliveryController.retryGeneration);
router.get('/timesheets/payroll-ready', auth, timesheetWorkflowController.payrollReady);
router.get('/timesheets/week/pdf', auth, requireAnyPermission('VIEW_OWN_TIMESHEET','VIEW_TEAM_TIMESHEET','VIEW_ALL_TIMESHEETS'), require('../controllers/staffTimesheetPdfController').download);
router.get('/timesheets/:id', auth, timesheetWorkflowController.detail);
router.post('/timesheets/:id/submit', auth, timesheetWorkflowController.submit);
router.post('/timesheets/:id/approve', auth, timesheetWorkflowController.approve);
router.post('/timesheets/:id/reject', auth, timesheetWorkflowController.reject);
router.post('/timesheets/:id/correction', auth, timesheetWorkflowController.requestCorrection);
router.post('/timesheets/:id/amend', auth, timesheetWorkflowController.amend);
router.post('/timesheets/status', auth, timesheetWorkflowController.legacyStatus);

router.post('/admin/save', auth, requireInputPermission('attendance_input'), attendanceController.saveAttendance);

router.post('/admin/delete', auth, requireInputPermission('attendance_input'), attendanceController.deleteAttendance);
router.post('/admin/restore', auth, requireInputPermission('attendance_input'), attendanceController.restoreAttendance);

module.exports = router;
