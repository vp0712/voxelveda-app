const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');

const {
  createUser,
  getPermissionCatalog,
  getUsers,
  updateUser,
  updateUserAccess,
  resetUserPassword,
  resendUserInvitation,
  deleteUser
} = require('../controllers/userController');

const router = express.Router();

router.use(authMiddleware, requireAnyPermission('MANAGE_USERS'));
router.get('/permissions/catalog', getPermissionCatalog);
router.get('/', getUsers);
router.post('/', createUser);
router.post('/:id', updateUser);
router.post('/:id/access', updateUserAccess);
router.post('/:id/reset-password', resetUserPassword);
router.post('/:id/resend-invitation', resendUserInvitation);
router.delete('/:id', deleteUser);

module.exports = router;
