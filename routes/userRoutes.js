const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const {
  createUser,
  getUsers,
  updateUserAccess,
  resetUserPassword
} = require('../controllers/userController');

const router = express.Router();

router.get('/', authMiddleware, requireRole('admin'), getUsers);
router.post('/', authMiddleware, requireRole('admin'), createUser);
router.post('/:id/access', authMiddleware, requireRole('admin'), updateUserAccess);
router.post('/:id/reset-password', authMiddleware, requireRole('admin'), resetUserPassword);

module.exports = router;
