const {
  WorkflowError,
  actionWorkflow,
  cancelWorkflow,
  createDefinition,
  getInstance,
  listDefinitions,
  listInbox,
  listRequests,
  reassignWorkflow,
  startWorkflow
} = require('../services/workflowService');

function respondError(res, error) {
  if (error instanceof WorkflowError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code, details: error.details || undefined });
  }
  console.error('WORKFLOW API ERROR:', error);
  return res.status(500).json({ message: 'Workflow operation failed', code: 'WORKFLOW_INTERNAL_ERROR' });
}

exports.definitions = async (_req, res) => {
  try { return res.json({ definitions: await listDefinitions() }); }
  catch (error) { return respondError(res, error); }
};

exports.createDefinition = async (req, res) => {
  try {
    const definition = await createDefinition({ user: req.user, input: req.body, req });
    return res.status(201).json({ message: 'Workflow definition published', definition });
  } catch (error) { return respondError(res, error); }
};

exports.start = async (req, res) => {
  try {
    const instance = await startWorkflow({ user: req.user, input: req.body, req });
    return res.status(201).json({ message: instance.status === 'BLOCKED_ASSIGNMENT' ? 'Request saved and waiting for reviewer assignment' : 'Approval request submitted', instance });
  } catch (error) { return respondError(res, error); }
};

exports.inbox = async (req, res) => {
  try { return res.json({ items: await listInbox(req.user.id, { status: String(req.query.status || 'PENDING').toUpperCase() }) }); }
  catch (error) { return respondError(res, error); }
};

exports.requests = async (req, res) => {
  try { return res.json({ items: await listRequests(req.user.id) }); }
  catch (error) { return respondError(res, error); }
};

exports.detail = async (req, res) => {
  try { return res.json({ instance: await getInstance(req.params.instanceId, req.user) }); }
  catch (error) { return respondError(res, error); }
};

exports.action = async (req, res) => {
  try {
    const instance = await actionWorkflow({
      instanceId: req.params.instanceId, user: req.user,
      action: req.body.action, comment: req.body.comment, req
    });
    return res.json({ message: `Approval ${String(req.body.action).toLowerCase().replace('_', ' ')} recorded`, instance });
  } catch (error) { return respondError(res, error); }
};

exports.cancel = async (req, res) => {
  try {
    const instance = await cancelWorkflow({ instanceId: req.params.instanceId, user: req.user, comment: req.body.comment, req });
    return res.json({ message: 'Approval request cancelled', instance });
  } catch (error) { return respondError(res, error); }
};

exports.reassign = async (req, res) => {
  try {
    const instance = await reassignWorkflow({
      instanceId: req.params.instanceId, assigneeUserId: Number(req.body.assignee_user_id),
      user: req.user, comment: req.body.comment, req
    });
    return res.json({ message: 'Approval reviewer assigned', instance });
  } catch (error) { return respondError(res, error); }
};
