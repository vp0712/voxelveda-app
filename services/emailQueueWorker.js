const { isEmailConfigured } = require('./emailService');
const { processEmailQueue } = require('./emailQueue');
const { backgroundJobService } = require('./backgroundJobService');

async function processEmailQueueCycle() {
  const outcomes = await processEmailQueue(Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 10));
  for (const outcome of outcomes) {
    console.log(
      `Email queue delivery evidence: queue_id=${outcome.id} status=${outcome.status} provider_message_id=${outcome.status === 'SENT' ? 'yes' : 'no'} error_category=${outcome.errorCategory || 'none'} error_code=${outcome.errorCode || 'none'} response_code=${outcome.responseCode || 'none'}`
    );
  }
  if (outcomes.length && process.env.VV_RESEND_RELEASE_VERIFY === 'true') {
    try {
      const evidence=await require('./releaseResendVerificationService').readResendVerificationEvidence(process.env.VV_RESEND_RELEASE_TEST_ID);
      console.log('Release Resend retained queue evidence',JSON.stringify(evidence));
    } catch(error) {
      console.warn('Release Resend evidence unavailable: '+(error.code||'RELEASE_VERIFICATION_FAILED'));
    }
  }
  return {
    outcomes,
    processed: outcomes.length,
    failed: outcomes.filter((item) => ['FAILED', 'RETRY'].includes(String(item.status || '').toUpperCase())).length
  };
}

const scheduler = backgroundJobService.createScheduler({
  jobKey: 'email_queue_delivery',
  description: 'Deliver queued company email with durable retry history',
  handler: processEmailQueueCycle,
  enabled: isEmailConfigured,
  intervalMs: () => Number(process.env.EMAIL_QUEUE_INTERVAL_MS || 30000),
  initialDelayMs: 5000,
  leaseMs: 120000,
  maxAttempts: Number(process.env.EMAIL_QUEUE_WORKER_MAX_ATTEMPTS || 8)
});

function runEmailQueue(options = {}) {
  return scheduler.run(options);
}

function startEmailQueueWorker() {
  return scheduler.start();
}

function stopEmailQueueWorker() {
  scheduler.stop();
}

module.exports = { processEmailQueueCycle, runEmailQueue, startEmailQueueWorker, stopEmailQueueWorker };
