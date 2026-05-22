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

    if (role === 'admin') {
      return next();
    }

    const permissions = parsePermissions(req.user?.permissions);

    if (!permissions.includes(permission)) {
      return res.status(403).json({
        message: 'Access denied: this section is not enabled for your account'
      });
    }

    next();
  };
};
