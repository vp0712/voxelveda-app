const pool = require('../config/db');
const { HIGH_RISK_PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');
const { activePermissionProjection, canonicalPermission } = require('../services/authorizationService');
const { permissionDifference } = require('../services/userSecurityService');

const ALLOWED_ROLES = new Set(Object.keys(ROLE_TEMPLATES));

function normalizeRole(value) {
  return String(value || 'staff').trim().toLowerCase();
}

function requestedPermissions(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !canonicalPermission(item).length)) {
    throw Object.assign(new Error('Permission list contains unavailable permissions.'), { statusCode: 400, code: 'PERMISSION_UNAVAILABLE' });
  }
  return activePermissionProjection(value);
}

function authorityWarning(req, targetUserId, targetRole, proposedRole) {
  const actorRole = normalizeRole(req.user?.role);
  if (proposedRole === 'super_admin' && actorRole !== 'super_admin') {
    return 'Only a super administrator can grant the super administrator role.';
  }
  if (Number(req.user?.id) === Number(targetUserId) && proposedRole !== targetRole) {
    return 'You cannot change your own role. The preview is shown for review only.';
  }
  if (targetRole === 'super_admin' && actorRole !== 'super_admin') {
    return 'Only a super administrator can manage this account. The preview is shown for review only.';
  }
  return null;
}

exports.previewPermissionDifference = async (req, res) => {
  try {
    const retiredFields = ['employee_number', 'department', 'manager_id', 'access_scope', 'employee_id', 'employment_type', 'job_title', 'salary', 'hourly_rate', 'payroll', 'hire_date'];
    if (retiredFields.some((key) => Object.hasOwn(req.body || {}, key))) {
      return res.status(400).json({ code: 'FIELD_UNAVAILABLE', message: 'Employment fields are no longer available.' });
    }
    const userId = Number(req.params.id);
    const proposedRole = normalizeRole(req.body.role);
    const overrides = requestedPermissions(req.body.permissions);
    if (!userId) {
      return res.status(400).json({ message: 'Valid user and role are required' });
    }

    const [[target]] = await pool.query(
      'SELECT role, permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId]
    );
    if (!target) return res.status(404).json({ message: 'User not found' });
    const targetRole = normalizeRole(target.role);
    if (!ALLOWED_ROLES.has(proposedRole) && proposedRole !== targetRole) return res.status(400).json({ message: 'This role is not available for assignment.' });
    const storedPermissions = activePermissionProjection(target.permissions);
    const previous = [...new Set([...(ROLE_TEMPLATES[targetRole] || []), ...storedPermissions])];
    const proposed = [...new Set([...(ROLE_TEMPLATES[proposedRole] || []), ...overrides])];
    const difference = permissionDifference(previous, proposed);
    const warning = authorityWarning(req, userId, targetRole, proposedRole);

    return res.json({
      current_role: targetRole,
      proposed_role: proposedRole,
      ...difference,
      high_risk_added: difference.added.filter((item) => HIGH_RISK_PERMISSIONS.has(item)),
      allowed_to_apply: !warning,
      authority_warning: warning
    });
  } catch (error) {
    console.error('previewPermissionDifference error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Unable to preview access change', code: error.code });
  }
};
