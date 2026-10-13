const { scoreRequestRisk } = require('../services/adaptiveRiskService');

module.exports = function enterpriseMutationGuard(req, res, next) {
  const risk = scoreRequestRisk(req);
  if (req.securityContext?.impersonation) {
    return res.status(403).json({ message: 'Enterprise-control mutations are forbidden during impersonation.', code: 'IMPERSONATION_WRITE_DENIED', risk });
  }
  if (req.securityContext?.breakGlass && !req.body?.emergency_reason) {
    return res.status(403).json({ message: 'Break-glass mutations require an explicit emergency_reason.', code: 'BREAK_GLASS_REASON_REQUIRED', risk });
  }
  req.enterpriseRisk = risk;
  return next();
};
