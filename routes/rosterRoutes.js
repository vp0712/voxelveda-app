const express = require('express');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const {
  listRoster,
  listMyRoster,
  saveShift,
  generateRoster,
  deleteShift,
  publishRoster
} = require('../controllers/rosterController');

const router = express.Router();

router.get('/', requireAnyPermission('EDIT_ATTENDANCE'), listRoster);
router.get('/my', listMyRoster);
router.post('/', requireAnyPermission('EDIT_ATTENDANCE'), saveShift);
router.post('/generate', requireAnyPermission('EDIT_ATTENDANCE'), generateRoster);
router.post('/delete', requireAnyPermission('EDIT_ATTENDANCE'), deleteShift);
router.post('/publish', requireAnyPermission('EDIT_ATTENDANCE'), publishRoster);

module.exports = router;
