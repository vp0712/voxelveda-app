'use strict';

const { CONTROL_STATES } = require('./runtimeState');

// A successful configuration check is not evidence that a message was sent,
// that the sender domain was verified, or that a recipient received anything.
function emailTransportReadiness(result, selected) {
  const transport = String(result?.transport || selected || 'unknown');
  if (['smtp','https_relay'].includes(transport)) {
    return { state: CONTROL_STATES.EXTERNALLY_VERIFIED,
      detail: `Company email transport health verified: ${transport}; recipient delivery is not confirmed` };
  }
  if (transport !== 'resend') return { state: CONTROL_STATES.CONFIGURED,
    detail: 'Configured company email provider requires an authorised transport health check; recipient receipt is unverified' };
  if (result?.sender_domain_verified === true && result?.credentials_verified === true) {
    return { state: CONTROL_STATES.EXTERNALLY_VERIFIED,
      detail: 'Resend API credentials and sender domain verified; recipient delivery is not confirmed' };
  }
  if (result?.credentials_verified === true) {
    return { state: CONTROL_STATES.OPERATIONAL,
      detail: 'Resend API authenticated; sender-domain capability and recipient delivery remain unverified' };
  }
  return { state: CONTROL_STATES.CONFIGURED,
    detail: 'Resend is configured; a controlled send is required to verify sending access and sender identity; recipient receipt is unverified' };
}

module.exports = { emailTransportReadiness };
