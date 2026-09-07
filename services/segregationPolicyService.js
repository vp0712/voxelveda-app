const pool = require('../config/db');
const { ROLE_TEMPLATES } = require('../config/permissionCatalog');
const { canonicalPermission } = require('./authorizationService');

function proposedPermissions(role, overrides = []) {
  const values = [...(ROLE_TEMPLATES[String(role || '').toLowerCase()] || []), ...(Array.isArray(overrides) ? overrides : [])];
  return new Set(values.flatMap(canonicalPermission));
}

async function findSegregationConflicts(role, overrides, connection = pool) {
  try {
    const grants = proposedPermissions(role, overrides);
    const [policies] = await connection.query('SELECT policy_key,permission_a,permission_b,severity FROM segregation_policies WHERE active=1');
    return policies.filter((policy) => grants.has(policy.permission_a) && grants.has(policy.permission_b));
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function assertNoSegregationConflicts(role, overrides, connection = pool) {
  const conflicts = await findSegregationConflicts(role, overrides, connection);
  if (!conflicts.length) return;
  const error = new Error(`Access change violates segregation policy: ${conflicts.map((item) => item.policy_key).join(', ')}`);
  error.statusCode = 409;
  error.conflicts = conflicts;
  throw error;
}

module.exports = { assertNoSegregationConflicts, findSegregationConflicts, proposedPermissions };
