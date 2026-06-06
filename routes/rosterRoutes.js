const express = require('express');
const requireRole = require('../middleware/roleMiddleware');
const requireInputPermission = require('../middleware/inputPermissionMiddleware');
const {
  listRoster,
  listMyRoster,
  saveShift,
  generateRoster,
  deleteShift
} = require('../controllers/rosterController');

const router = express.Router();

router.get('/', requireRole('admin'), listRoster);
router.get('/my', listMyRoster);
router.post('/', requireRole('admin'), requireInputPermission('roster_input'), saveShift);
router.post('/generate', requireRole('admin'), requireInputPermission('roster_input'), generateRoster);
router.post('/delete', requireRole('admin'), requireInputPermission('roster_input'), deleteShift);

module.exports = router;
