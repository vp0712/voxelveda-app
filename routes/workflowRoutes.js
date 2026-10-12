const express = require('express');
const workflowController = require('../controllers/workflowController');
const { requireAnyPermission } = require('../middleware/authorizationMiddleware');
const { bodyContract } = require('../middleware/requestContractMiddleware');
const requireStepUp = require('../middleware/stepUpMiddleware');

const router = express.Router();

router.get('/definitions', requireAnyPermission('VIEW_APPROVALS'), workflowController.definitions);
router.post(
  '/definitions',
  requireAnyPermission('MANAGE_WORKFLOWS'),
  requireStepUp('PUBLISH_WORKFLOW_DEFINITION'),
  bodyContract(['workflow_key', 'name', 'module', 'description', 'allow_self_approval', 'steps'], { required: ['workflow_key', 'name', 'module', 'steps'] }),
  workflowController.createDefinition
);
router.get('/my-approvals', requireAnyPermission('VIEW_APPROVALS'), workflowController.inbox);
router.get('/my-requests', requireAnyPermission('VIEW_APPROVALS'), workflowController.requests);
router.post(
  '/instances',
  requireAnyPermission('CREATE_APPROVAL_REQUEST'),
  bodyContract(['workflow_key', 'entity_type', 'entity_id', 'title', 'summary', 'payload', 'comment'], { required: ['workflow_key', 'entity_type', 'entity_id', 'title'] }),
  workflowController.start
);
router.get('/instances/:instanceId', requireAnyPermission('VIEW_APPROVALS'), workflowController.detail);
router.post(
  '/instances/:instanceId/action',
  requireAnyPermission('ACTION_APPROVALS'),
  bodyContract(['action', 'comment'], { required: ['action'] }),
  workflowController.action
);
router.post(
  '/instances/:instanceId/cancel',
  requireAnyPermission('CREATE_APPROVAL_REQUEST'),
  bodyContract(['comment'], { allowEmpty: true }),
  workflowController.cancel
);
router.post(
  '/instances/:instanceId/reassign',
  requireAnyPermission('MANAGE_WORKFLOWS'),
  requireStepUp('REASSIGN_WORKFLOW_APPROVER'),
  bodyContract(['assignee_user_id', 'comment'], { required: ['assignee_user_id'] }),
  workflowController.reassign
);

module.exports = router;
