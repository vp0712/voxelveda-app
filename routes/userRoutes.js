const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');

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
router.post('/', requireStepUp('CREATE_USER'), bodyContract(['name','username','email','role','permissions','department','manager_id','access_scope'], { required: ['name','email'] }), createUser);
router.post('/:id', requireStepUp('CHANGE_USER_RECORD'), bodyContract(['name','username','email','role','permissions','active','department','manager_id','access_scope','reason'], { required: ['name','username','email'] }), updateUser);
router.post('/:id/access', requireStepUp('CHANGE_ROLE_OR_PERMISSIONS'), bodyContract(['role','active','permissions','reason'], { required: ['role','active','permissions','reason'] }), updateUserAccess);
router.post('/:id/access/preview', bodyContract(['role','permissions'], { required: ['role'] }), previewPermissionDifference);
router.post('/:id/account-state', requireStepUp('TERMINATE_USER_ACCESS'), bodyContract(['state','reason','transfer_to_user_id'], { required: ['state','reason'] }), changeAccountState);
router.post('/:id/compromised', requireStepUp('MARK_ACCOUNT_COMPROMISED'), bodyContract(['reason'], { required: ['reason'] }), markAccountCompromised);
router.post('/:id/revoke-invitation', requireStepUp('REVOKE_USER_INVITATION'), bodyContract(['reason'], { required: ['reason'] }), revokeInvitation);
router.post('/:id/revoke-sessions', requireStepUp('REVOKE_USER_SESSIONS'), bodyContract(['reason'], { required: ['reason'] }), forceRevokeSessions);
router.post('/:id/access-review', requireStepUp('REVIEW_PRIVILEGED_ACCESS'), bodyContract(['decision','reason'], { required: ['decision','reason'] }), completeAccessReview);
router.post('/:id/reset-password', requireStepUp('ADMIN_PASSWORD_RESET'), bodyContract(['reason'], { required: ['reason'] }), resetUserPassword);
router.post('/:id/resend-invitation', requireStepUp('RESEND_USER_INVITATION'), bodyContract(['reason'], { required: ['reason'] }), resendUserInvitation);
module.exports = router;
