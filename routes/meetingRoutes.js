const express = require('express');
const requireRole = require('../middleware/roleMiddleware');
const {
  listMeetings,
  listMyMeetings,
  saveMeeting,
  deleteMeeting
} = require('../controllers/meetingController');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');

const router = express.Router();

router.get('/', requireRole('admin'), listMeetings);
router.get('/my', listMyMeetings);
router.post('/', requireRole('admin'), requireInputPermission('meetings_input'), saveMeeting);
router.post('/delete', requireRole('admin'), requireInputPermission('meetings_input'), deleteMeeting);

module.exports = router;
