const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireRole = require('../middleware/roleMiddleware');

const {
  createUser,
  getUsers,
  updateUser,
  updateUserAccess,
  resetUserPassword,
  resendUserInvitation,
  deleteUser
} = require('../controllers/userController');

const router = express.Router();

router.get('/', authMiddleware, requireRole('admin', 'super_admin'), getUsers);
router.post('/', authMiddleware, requireRole('admin', 'super_admin'), createUser);
router.post('/:id', authMiddleware, requireRole('admin', 'super_admin'), updateUser);
router.post('/:id/access', authMiddleware, requireRole('admin', 'super_admin'), updateUserAccess);
router.post('/:id/reset-password', authMiddleware, requireRole('admin', 'super_admin'), resetUserPassword);
router.post('/:id/resend-invitation', authMiddleware, requireRole('admin', 'super_admin'), resendUserInvitation);
router.delete('/:id', authMiddleware, requireRole('admin', 'super_admin'), deleteUser);

module.exports = router;
