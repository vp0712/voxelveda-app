const express = require('express');
const requireRole = require('../middleware/roleMiddleware');
const {
  listMeetings,
  listMyMeetings,
  saveMeeting,
  deleteMeeting
} = require('../controllers/meetingController');

const router = express.Router();

router.get('/', requireRole('admin'), listMeetings);
router.get('/my', listMyMeetings);
router.post('/', requireRole('admin'), saveMeeting);
router.post('/delete', requireRole('admin'), deleteMeeting);

module.exports = router;
