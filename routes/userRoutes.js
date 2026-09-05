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
  previewPermissionDifference,
  changeAccountState,
  markAccountCompromised,
  revokeInvitation,
  forceRevokeSessions,
  completeAccessReview
} = require('../controllers/userController');

const router = express.Router();

router.use(authMiddleware, requireAnyPermission('MANAGE_USERS'));
router.get('/permissions/catalog', getPermissionCatalog);
router.get('/', getUsers);
router.post('/', requireStepUp('CREATE_USER'), createUser);
router.post('/:id', requireStepUp('CHANGE_USER_RECORD'), updateUser);
router.post('/:id/access', requireStepUp('CHANGE_ROLE_OR_PERMISSIONS'), updateUserAccess);
router.post('/:id/access/preview', previewPermissionDifference);
router.post('/:id/account-state', requireStepUp('TERMINATE_USER_ACCESS'), changeAccountState);
router.post('/:id/compromised', requireStepUp('MARK_ACCOUNT_COMPROMISED'), markAccountCompromised);
router.post('/:id/revoke-invitation', requireStepUp('REVOKE_USER_INVITATION'), revokeInvitation);
router.post('/:id/revoke-sessions', requireStepUp('REVOKE_USER_SESSIONS'), forceRevokeSessions);
router.post('/:id/access-review', requireStepUp('REVIEW_PRIVILEGED_ACCESS'), completeAccessReview);
router.post('/:id/reset-password', requireStepUp('ADMIN_PASSWORD_RESET'), resetUserPassword);
router.post('/:id/resend-invitation', requireStepUp('RESEND_USER_INVITATION'), resendUserInvitation);
module.exports = router;
