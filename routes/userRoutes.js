const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

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
router.post('/', requireStepUp('CREATE_USER'), createUser);
router.post('/:id', requireStepUp('CHANGE_USER_RECORD'), updateUser);
router.post('/:id/access', requireStepUp('CHANGE_ROLE_OR_PERMISSIONS'), updateUserAccess);
router.post('/:id/reset-password', requireStepUp('ADMIN_PASSWORD_RESET'), resetUserPassword);
router.post('/:id/resend-invitation', requireStepUp('RESEND_USER_INVITATION'), resendUserInvitation);
router.delete('/:id', requireStepUp('TERMINATE_USER_ACCESS'), deleteUser);

module.exports = router;
