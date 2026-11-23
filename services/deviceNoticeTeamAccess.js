'use strict';

function eligibleIds(env) { return require('./aiTeamService').aiTeamRecipientIds(env); }
function activeAuthorization(req) {
  return Boolean(req.session?.id && req.authType !== 'api_token' && !req.securityContext?.impersonation &&
    !req.securityContext?.breakGlass && require('./aiTeamService').isAiTeamEligible(req.user));
}

module.exports = { eligibleIds, activeAuthorization };
