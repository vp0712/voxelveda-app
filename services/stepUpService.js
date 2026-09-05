const DEFAULT_STEP_UP_TTL_MINUTES = 15;

function stepUpTtlMinutes() {
  const configured = Number(process.env.STEP_UP_TTL_MINUTES || DEFAULT_STEP_UP_TTL_MINUTES);
  return Number.isFinite(configured) && configured >= 1 && configured <= 60
    ? configured
    : DEFAULT_STEP_UP_TTL_MINUTES;
}

function isStepUpFresh(session, now = Date.now()) {
  if (Number(session?.assuranceLevel || 0) < 3 || !session?.stepUpVerifiedAt) return false;
  const verifiedAt = new Date(session.stepUpVerifiedAt).getTime();
  if (!Number.isFinite(verifiedAt)) return false;
  return now - verifiedAt >= 0 && now - verifiedAt <= stepUpTtlMinutes() * 60 * 1000;
}

function stepUpExpiry(session) {
  if (!session?.stepUpVerifiedAt) return null;
  const verifiedAt = new Date(session.stepUpVerifiedAt).getTime();
  if (!Number.isFinite(verifiedAt)) return null;
  return new Date(verifiedAt + stepUpTtlMinutes() * 60 * 1000).toISOString();
}

module.exports = { isStepUpFresh, stepUpExpiry, stepUpTtlMinutes };
