function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = function requirePermission(permission) {
  return (req, res, next) => {
    const role = String(req.user?.role || '').trim().toLowerCase();

    if (['admin', 'super_admin'].includes(role)) {
      return next();
    }

    const permissions = parsePermissions(req.user?.permissions);

    const groupAllowed = permission === 'stock'
      && ['stock', 'stock_in', 'stock_out', 'raw_material', 'packaging'].some((item) => permissions.includes(item));

    if (!permissions.includes(permission) && !groupAllowed) {
      return res.status(403).json({
        message: 'Access denied: this section is not enabled for your account'
      });
    }

    next();
  };
};
