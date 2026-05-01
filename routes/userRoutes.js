const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const {
  createUser,
  getUsers
} = require('../controllers/userController');

const router = express.Router();

router.get('/', authMiddleware, requireRole('admin'), getUsers);
router.post('/', authMiddleware, requireRole('admin'), createUser);

module.exports = router;