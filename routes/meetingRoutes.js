const express = require('express');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const {
  listMeetings,
  listMyMeetings,
  saveMeeting,
  deleteMeeting
} = require('../controllers/meetingController');

const router = express.Router();

router.get('/', requireAnyPermission('MANAGE_MEETINGS'), listMeetings);
router.get('/my', listMyMeetings);
router.post('/', requireAnyPermission('MANAGE_MEETINGS'), saveMeeting);
router.post('/delete', requireAnyPermission('MANAGE_MEETINGS'), deleteMeeting);

module.exports = router;
