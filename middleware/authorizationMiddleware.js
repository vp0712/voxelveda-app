const { hasAnyPermission } = require('../services/authorizationService');

function requireAnyPermission(...permissions) {
  const required = permissions.flat().filter(Boolean);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    if (!required.length || !hasAnyPermission(req.user, required)) {
      return res.status(403).json({ message: 'Access denied: this action is not permitted', code: 'PERMISSION_DENIED' });
    }
    return next();
  };
}

module.exports = { requireAnyPermission };
