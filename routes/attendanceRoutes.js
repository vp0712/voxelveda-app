const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const attendanceController = require('../controllers/attendanceController');

router.post('/clock-in', authMiddleware, attendanceController.clockIn);
router.post('/clock-out', authMiddleware, attendanceController.clockOut);
router.get('/my', authMiddleware, attendanceController.myAttendance);
router.get('/all', authMiddleware, attendanceController.allAttendance);

module.exports = router;
