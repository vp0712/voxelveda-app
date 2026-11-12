'use strict';
// Run inside the authorised application runtime. Default mode is read-only;
// --queue admits only the two explicitly enabled synthetic release fixtures.
// The existing durable worker sends them; this command never drains the queue.
const pool = require('../config/db');
const { queueAuthorisedResendVerification, readResendVerificationEvidence } = require('../services/releaseResendVerificationService');
async function main() {
  const args = process.argv.slice(2);
  if (args.some(value => !['--queue', '--evidence'].includes(value)) || args.length > 1) throw Object.assign(new Error('Use --evidence (default) or --queue.'), { code: 'RELEASE_ARGUMENT_INVALID' });
  const result = args[0] === '--queue'
    ? await queueAuthorisedResendVerification()
    : await readResendVerificationEvidence(process.env.VV_RESEND_RELEASE_TEST_ID);
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error('Release Resend verification unavailable: ' + (error.code || 'RELEASE_VERIFICATION_FAILED')); process.exitCode = 1; })
  .finally(() => pool.end());
