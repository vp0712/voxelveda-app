const pool = require('../config/db');
const { HIGH_RISK_PERMISSIONS, LEGACY_PERMISSION_MAP, PERMISSIONS, ROLE_TEMPLATES } = require('../config/permissionCatalog');
const { permissionDifference } = require('../services/userSecurityService');

const LEGACY_PERMISSIONS = [
  'dashboard','rfqs','rfqs_input','invoices','invoices_input','customers','customers_input',
  'tasks','tasks_input','roster','roster_input','attendance','attendance_input','attendance_qr_bypass',
  'staff','settings','stock','stock_in','stock_in_input','stock_out','stock_out_input','raw_material',
  'raw_material_input','packaging','packaging_input','meetings','meetings_input','suppliers',
  'suppliers_input','expenses','expenses_input','compliance','compliance_input','competitors',
  'competitors_input','finance','finance_input','finance_setup','finance_post_transaction',
  'finance_create_journal','finance_lock_period','finance_reconcile','finance_export',
  'finance_view_payroll','finance_void'
];

const ALLOWED_ROLES = new Set([
  'admin','super_admin','finance_admin','finance_user','accountant','hr','manager','supervisor',
  'sales','production','viewer','view_only','staff'
]);

function normalizeRole(value) {
  return String(value || 'staff').trim().toLowerCase();
}

function parsePermissions(value) {
  const allowed = new Set([...LEGACY_PERMISSIONS, ...PERMISSIONS]);
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map((item) => String(item).trim()).filter((item) => allowed.has(item) || LEGACY_PERMISSION_MAP[item.toLowerCase()]))];
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
    const userId = Number(req.params.id);
    const proposedRole = normalizeRole(req.body.role);
    const overrides = parsePermissions(req.body.permissions);
    if (!userId || !ALLOWED_ROLES.has(proposedRole)) {
      return res.status(400).json({ message: 'Valid user and role are required' });
    }

    const [[target]] = await pool.query(
      'SELECT role, permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId]
    );
    if (!target) return res.status(404).json({ message: 'User not found' });

    let storedPermissions = [];
    try {
      const parsed = typeof target.permissions === 'string' ? JSON.parse(target.permissions || '[]') : target.permissions;
      storedPermissions = parsePermissions(Array.isArray(parsed) ? parsed : []);
    } catch {}

    const targetRole = normalizeRole(target.role);
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
    return res.status(500).json({ message: 'Unable to preview access change' });
  }
};
