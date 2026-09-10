const { isEmailConfigured } = require('./emailService');
const { processEmailQueue } = require('./emailQueue');

let timer = null;
let initialTimer = null;
let busy = false;

async function runEmailQueue() {
  if (busy || !isEmailConfigured()) return;
  busy = true;
  try {
    await processEmailQueue(Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 10));
  } catch (error) {
    console.error('Email queue worker error:', error.message);
  } finally {
    busy = false;
  }
}

function startEmailQueueWorker() {
  if (timer || !isEmailConfigured()) return false;
  timer = setInterval(runEmailQueue, Number(process.env.EMAIL_QUEUE_INTERVAL_MS || 30000));
  timer.unref();
  initialTimer = setTimeout(runEmailQueue, 5000);
  initialTimer.unref();
  return true;
}

function stopEmailQueueWorker() {
  if (timer) clearInterval(timer);
  if (initialTimer) clearTimeout(initialTimer);
  timer = null;
  initialTimer = null;
  busy = false;
}

module.exports = { runEmailQueue, startEmailQueueWorker, stopEmailQueueWorker };
