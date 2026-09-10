const assert = require('assert');
const { hasPermission } = require('../services/authorizationService');
const {
  WorkflowError,
  actionWorkflow,
  resolveApprovers
} = require('../services/workflowService');

const users = [
  { id: 1, name: 'Requester', role: 'staff', permissions: '[]', manager_id: 2 },
  { id: 2, name: 'Manager', role: 'manager', permissions: '[]', manager_id: null },
  { id: 3, name: 'Finance', role: 'finance_admin', permissions: '[]', manager_id: null },
  { id: 4, name: 'Viewer', role: 'viewer', permissions: '["APPROVE_PAYMENT"]', manager_id: null },
  { id: 5, name: 'Admin requester', role: 'admin', permissions: '[]', manager_id: null }
];

const db = {
  async query(sql) {
    assert(sql.includes('FROM users'), 'approver resolution should only query active users');
    return [users];
  }
};

(async () => {
  assert(hasPermission(users[2], 'ACTION_APPROVALS'), 'finance administrators can action approvals');
  assert(!hasPermission(users[0], 'ACTION_APPROVALS'), 'staff cannot action approvals by default');

  const finance = await resolveApprovers(db, {
    approver_type: 'PERMISSION', approver_value: 'APPROVE_PAYMENT'
  }, 1, false);
  assert.deepStrictEqual(finance.map((user) => user.id).sort(), [3, 5], 'permission resolver must also enforce ACTION_APPROVALS');

  const manager = await resolveApprovers(db, {
    approver_type: 'MANAGER', approver_value: null
  }, 1, false);
  assert.deepStrictEqual(manager.map((user) => user.id), [2], 'manager resolver must use the requester manager');

  const noSelf = await resolveApprovers(db, {
    approver_type: 'PERMISSION', approver_value: 'APPROVE_PAYMENT'
  }, 5, false);
  assert(!noSelf.some((user) => user.id === 5), 'requester must be excluded by default');

  const allowSelf = await resolveApprovers(db, {
    approver_type: 'PERMISSION', approver_value: 'APPROVE_PAYMENT'
  }, 5, true);
  assert(allowSelf.some((user) => user.id === 5), 'versioned definitions may explicitly allow self approval');

  await assert.rejects(
    () => actionWorkflow({ instanceId: 'test', user: users[2], action: 'DELETE', comment: '' }),
    (error) => error instanceof WorkflowError && error.code === 'WORKFLOW_ACTION_INVALID'
  );
  await assert.rejects(
    () => actionWorkflow({ instanceId: 'test', user: users[2], action: 'REJECT', comment: '' }),
    (error) => error instanceof WorkflowError && error.code === 'WORKFLOW_COMMENT_REQUIRED'
  );

  console.log('ERP Wave 2 workflow lifecycle tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
