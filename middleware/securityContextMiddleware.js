function denyDelegatedSensitiveAccess(req, res, next) {
  if (req.securityContext?.impersonation) {
    return res.status(403).json({ message: 'This operation is unavailable while impersonating another user', code: 'IMPERSONATION_RESTRICTED' });
  }
  if (req.securityContext?.breakGlass) {
    return res.status(403).json({ message: 'Break-glass access cannot be used for banking or payment operations', code: 'BREAK_GLASS_FINANCE_RESTRICTED' });
  }
  return next();
}

module.exports = { denyDelegatedSensitiveAccess };
