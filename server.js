const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error && process.env.NODE_ENV !== 'production') {
  console.warn('.env file not loaded; using shell environment variables.');
}

console.log('Server starting...');

const { validateSecurityEnvironment } = require('./config/security');
validateSecurityEnvironment();

const app = require('./app');
const { isEmailConfigured, verifyConnection } = require('./services/emailService');
const { processEmailQueue } = require('./services/emailQueue');
const { ensureFinanceSchema } = require('./services/financeSchema');
const { ensureSecuritySchema } = require('./services/securitySchema');
const {
  startWeeklyTimesheetScheduler,
  stopWeeklyTimesheetScheduler
} = require('./services/weeklyTimesheetScheduler');

if (process.env.ENABLE_ADMIN_BOOTSTRAP === 'true') {
  require('./utils/seedAdmin')();
}

const PORT = Number(process.env.PORT || 5001);
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  console.log(`Local entry: http://localhost:${PORT}/`);
});

ensureFinanceSchema()
  .then(() => console.log('Finance foundation schema ready.'))
  .catch((error) => console.error('Finance schema initialization failed:', error.message));

ensureSecuritySchema()
  .then(() => console.log('Security schema ready.'))
  .catch((error) => console.error('Security schema initialization failed:', error.message));

let emailQueueBusy = false;
async function runEmailQueue() {
  if (emailQueueBusy || !isEmailConfigured()) return;
  emailQueueBusy = true;
  try {
    await processEmailQueue(Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 10));
  } catch (error) {
    console.error('Email queue worker error:', error.message);
  } finally {
    emailQueueBusy = false;
  }
}

if (isEmailConfigured()) {
  verifyConnection()
    .then(() => console.log('Hostinger SMTP connection verified.'))
    .catch((error) => console.error('Hostinger SMTP verification failed:', error.message));
  const emailQueueTimer = setInterval(
    runEmailQueue,
    Number(process.env.EMAIL_QUEUE_INTERVAL_MS || 30000)
  );
  emailQueueTimer.unref();
  setTimeout(runEmailQueue, 5000).unref();
}

startWeeklyTimesheetScheduler();

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received. Closing server.`);
  stopWeeklyTimesheetScheduler();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
