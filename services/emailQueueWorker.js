const { isEmailConfigured } = require('./emailService');
const { processEmailQueue } = require('./emailQueue');
const { backgroundJobService } = require('./backgroundJobService');

async function processEmailQueueCycle() {
  const outcomes = await processEmailQueue(Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 10));
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
