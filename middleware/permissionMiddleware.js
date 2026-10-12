const { hasPermission } = require('../services/authorizationService');

module.exports = function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        message: 'Access denied: this action is not permitted',
        code: 'PERMISSION_DENIED'
      });
    }

    next();
  };
};
