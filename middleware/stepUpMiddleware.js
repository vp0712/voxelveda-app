const { logSecurityEvent } = require('../services/sessionService');
const { isStepUpFresh, stepUpTtlMinutes } = require('../services/stepUpService');

function requireStepUp(action = 'HIGH_RISK_ACTION') {
  return async (req, res, next) => {
    if (isStepUpFresh(req.session)) return next();

    await logSecurityEvent({
      actorId: req.user?.id,
      targetUserId: req.user?.id,
      sessionId: req.session?.id,
      eventType: 'STEP_UP_REQUIRED',
      result: 'DENIED',
      req,
      metadata: { action: String(action).slice(0, 80) }
    }).catch(() => {});

    return res.status(403).json({
      message: 'Security verification is required to continue.',
      code: 'STEP_UP_REQUIRED',
      action,
      assurance_required: 3,
      verification_valid_minutes: stepUpTtlMinutes()
    });
  };
}

module.exports = requireStepUp;
