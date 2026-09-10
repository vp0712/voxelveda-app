const path = require('node:path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');
const envResult = dotenv.config({ path: envPath });
if (envResult.error && process.env.NODE_ENV !== 'production') {
  console.warn('.env file not loaded; using shell environment variables.');
}

const { validateSecurityEnvironment } = require('./config/security');
const startupEnvironmentReadiness = validateSecurityEnvironment();
const app = require('./app');
const pool = require('./config/db');
const { isEmailConfigured, verifyConnection } = require('./services/emailService');
const { startEmailQueueWorker, stopEmailQueueWorker } = require('./services/emailQueueWorker');
const { verifyDatabaseConnection, refreshDatabaseAttestation } = require('./services/databaseRuntimeService');
const { runMigrations } = require('./services/migrationRunner');
const { allowedHosts } = require('./services/outboundRequestPolicy');
const { ensureFinanceSchema } = require('./services/financeSchema');
const { ensureSecuritySchema } = require('./services/securitySchema');
const { ensureHighRiskFinanceSchema } = require('./services/highRiskFinanceSchema');
const { ensureSecurityOperationsSchema } = require('./services/securityOperationsSchema');
const { ensureOperationalTrustSchema } = require('./services/operationalTrustSchema');
const { ensureAssuranceSchema } = require('./services/assuranceSchema');
const { ensureSecurityGovernanceSchema } = require('./services/securityGovernanceSchema');
const { ensureQmsSchema } = require('./services/qmsSchema');
const { ensureQmsAdvancedSchema } = require('./services/qmsAdvancedSchema');
const { ensureQmsQualityGovernanceSchema } = require('./services/qmsQualityGovernanceSchema');
const { ensureQmsEnterpriseCompletionSchema } = require('./services/qmsEnterpriseCompletionSchema');
const { ensureNotificationSchema } = require('./services/notificationSchema');
const { ensureTrashSchema } = require('./services/trashSchema');
const { ensureWorkflowSchema } = require('./services/workflowSchema');
const { ensureProcurementSchema } = require('./services/procurementSchema');
const { ensureWorkforceSchema } = require('./services/workforceSchema');
const { ensureEnterpriseControlPlaneSchema } = require('./services/enterpriseControlPlaneSchema');
const { startWeeklyTimesheetScheduler, stopWeeklyTimesheetScheduler } = require('./services/weeklyTimesheetScheduler');
const { startTrashPurgeScheduler, stopTrashPurgeScheduler } = require('./services/trashPurgeService');
const { startWorkflowSlaScheduler, stopWorkflowSlaScheduler } = require('./services/workflowEscalationService');
const {
  CONTROL_STATES,
  addWarning,
  detailedReadiness,
  markFailed,
  markReady,
  resetRuntimeState,
  setControl,
  setCriticalService,
  setMigrations,
  setPhase
} = require('./services/runtimeState');

const PORT = Number(process.env.PORT || 5001);
const HOST = '0.0.0.0';
let server = null;
let shuttingDown = false;

async function initializeCriticalSchemas() {
  const schemas = [
    ['finance', 'Finance foundation schema ready.', () => ensureFinanceSchema()],
    ['security', 'Security schema ready.', () => ensureSecuritySchema()],
    ['high_risk_finance', 'High-risk finance schema ready.', () => ensureHighRiskFinanceSchema()],
    ['security_operations', 'Security operations schema ready.', () => ensureSecurityOperationsSchema()],
    ['operational_trust', 'Operational trust schema ready.', () => ensureOperationalTrustSchema()],
    ['assurance', 'Continuous assurance schema ready.', () => ensureAssuranceSchema()],
    ['security_governance', 'Identity governance schema ready.', () => ensureSecurityGovernanceSchema()],
    ['qms', 'QMS controlled-record schema ready.', () => ensureQmsSchema()],
    ['qms_operations', 'QMS/MES operational schema ready.', () => ensureQmsAdvancedSchema()],
    ['qms_governance', 'QMS quality-release governance schema ready.', () => ensureQmsQualityGovernanceSchema()],
    ['qms_completion', 'QMS enterprise completion schema ready.', () => ensureQmsEnterpriseCompletionSchema()],
    ['notifications', 'Notification Centre schema ready.', () => ensureNotificationSchema()],
    ['trash', 'Enterprise Trash schema ready.', () => ensureTrashSchema()],
    ['workflow', 'Workflow Engine schema ready.', () => ensureWorkflowSchema()],
    ['procurement', 'Procurement lifecycle schema ready.', () => ensureProcurementSchema()],
    ['workforce', 'Workforce schema ready.', () => ensureWorkforceSchema()],
    ['enterprise_control_plane', 'Enterprise control plane schema ready.', () => ensureEnterpriseControlPlaneSchema()]
  ];

  for (const [key, message, initialize] of schemas) {
    setCriticalService(`schema_${key}`, CONTROL_STATES.INITIALIZING);
    try {
      await initialize();
      setCriticalService(`schema_${key}`, CONTROL_STATES.OPERATIONAL);
      console.log(message);
    } catch (error) {
      setCriticalService(`schema_${key}`, CONTROL_STATES.FAILED, error.code || 'SCHEMA_INITIALIZATION_FAILED');
      error.code = error.code || 'CRITICAL_SCHEMA_INITIALIZATION_FAILED';
      throw error;
    }
  }
}

function configured(keys) {
  return keys.every((key) => String(process.env[key] || '').trim());
}

async function initializeServices() {
  const redisConfigured = configured(['REDIS_URL']);
  setControl('redis_limiter', redisConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.DEGRADED,
    redisConfigured ? 'Redis settings are present; adapter verification is scheduled for Wave B' : 'Process-local limiter is active; do not scale to multiple replicas');

  const scannerConfigured = configured(['MALWARE_SCANNER_PROVIDER']);
  setControl('malware_scanner', scannerConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    scannerConfigured ? 'Provider is configured but no authenticated scan result has been verified' : 'No malware scanner provider configured');

  const backupConfigured = String(process.env.BACKUP_STATUS_PROVIDER || '').toLowerCase() === 'configured';
  setControl('backup_provider', backupConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    backupConfigured ? 'Provider metadata is configured; current backup evidence is checked separately' : 'No backup provider adapter configured');

  const webhookConfigured = configured(['WEBHOOK_SIGNING_KEY']);
  setControl('webhook_signing', webhookConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    webhookConfigured ? 'Signing key is configured; per-request verification remains authoritative' : 'Webhook signing key not configured');

  setControl('outbound_request_policy', CONTROL_STATES.OPERATIONAL,
    `Deny-by-default outbound policy loaded with ${allowedHosts().size} allowlisted host(s)`);

  const canonicalConfigured = process.env.FORCE_CANONICAL_HOST === 'true';
  setControl('canonical_domain', canonicalConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    canonicalConfigured ? 'Canonical redirect configured; external DNS/TLS evidence not verified by this process' : 'Canonical redirect disabled');

  const webauthnConfigured = configured(['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN']);
  setControl('webauthn', webauthnConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    webauthnConfigured ? 'WebAuthn settings present; no live ceremony adapter verified' : 'WebAuthn not configured');

  const objectStorageConfigured = configured(['OBJECT_STORAGE_PROVIDER']) || configured(['S3_BUCKET', 'S3_ENDPOINT']);
  setControl('object_storage', objectStorageConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    objectStorageConfigured ? 'Object storage settings present; adapter verification is scheduled for Wave D' : 'Durable object storage not configured');

  if (!isEmailConfigured()) {
    setControl('smtp', CONTROL_STATES.NOT_CONFIGURED, 'SMTP credentials are incomplete');
    return;
  }

  setControl('smtp', CONTROL_STATES.INITIALIZING, 'Verifying SMTP provider connection');
  try {
    await verifyConnection();
    setControl('smtp', CONTROL_STATES.EXTERNALLY_VERIFIED, 'SMTP provider accepted a verified transport connection');
    console.log('SMTP connection verified.');
  } catch (error) {
    setControl('smtp', CONTROL_STATES.DEGRADED, error.code || 'SMTP_CONNECTION_FAILED');
    addWarning('SMTP delivery is degraded; queued email remains available for retry after provider recovery');
    console.warn('SMTP verification failed; startup will continue with queued delivery degraded.');
  }
}

async function initializeWorkers() {
  startWeeklyTimesheetScheduler();
  startTrashPurgeScheduler();
  startWorkflowSlaScheduler();
  startEmailQueueWorker();
  setCriticalService('background_workers', CONTROL_STATES.OPERATIONAL,
    'Local schedulers initialized; distributed leases are scheduled for Wave B');
}

function listenApplication() {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, HOST);
    const startupError = (error) => reject(error);
    server.once('error', startupError);
    server.once('listening', () => {
      server.off('error', startupError);
      server.on('error', (error) => {
        markFailed(error, 'RUNTIME_HTTP_SERVER');
        console.error(`Runtime HTTP server failed: ${error.code || 'HTTP_SERVER_FAILED'}`);
        shutdown('HTTP_SERVER_ERROR', 1).catch(() => process.exit(1));
      });
      markReady();
      console.log(`Server ready on ${HOST}:${PORT}`);
      resolve(server);
    });
  });
}

async function bootstrap() {
  resetRuntimeState();
  console.log('Server bootstrap starting...');
  try {
    setPhase('VALIDATING_ENVIRONMENT');
    startupEnvironmentReadiness.warnings.forEach(addWarning);

    setPhase('CONNECTING_DATABASE');
    await verifyDatabaseConnection(pool);
    setCriticalService('database', CONTROL_STATES.OPERATIONAL);
    console.log('Database connection ready.');

    setPhase('RUNNING_MIGRATIONS');
    setMigrations({ state: CONTROL_STATES.INITIALIZING });
    const migrationResult = await runMigrations({ pool });
    setMigrations({ state: CONTROL_STATES.OPERATIONAL, ...migrationResult });
    setCriticalService('migrations', CONTROL_STATES.OPERATIONAL, migrationResult.schema_version || 'no migrations');
    console.log(`Migrations ready at ${migrationResult.schema_version || 'unversioned'} (${migrationResult.applied} applied, ${migrationResult.baselined || 0} baselined, ${migrationResult.skipped} verified).`);

    setPhase('INITIALIZING_CRITICAL_SCHEMAS');
    await initializeCriticalSchemas();
    await refreshDatabaseAttestation(pool);

    setPhase('INITIALIZING_SERVICES');
    await initializeServices();

    if (process.env.ENABLE_ADMIN_BOOTSTRAP === 'true') {
      await require('./utils/seedAdmin')();
    }

    setPhase('INITIALIZING_WORKERS');
    await initializeWorkers();

    setPhase('LISTENING');
    return await listenApplication();
  } catch (error) {
    const failedPhase = detailedReadiness().phase;
    markFailed(error, failedPhase);
    stopEmailQueueWorker();
    stopWeeklyTimesheetScheduler();
    stopTrashPurgeScheduler();
    stopWorkflowSlaScheduler();
    await pool.end().catch(() => {});
    const migrationContext = error?.details?.migration_id
      ? ` migration=${error.details.migration_id} cause=${error.details.cause_code || 'unknown'}`
      : '';
    console.error(`Startup failed during ${failedPhase}: ${error.code || 'STARTUP_FAILED'}${migrationContext}`);
    throw error;
  }
}

async function shutdown(signal = 'shutdown', exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Closing server.`);
  stopEmailQueueWorker();
  stopWeeklyTimesheetScheduler();
  stopTrashPurgeScheduler();
  stopWorkflowSlaScheduler();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await pool.end().catch(() => {});
  if (require.main === module) process.exit(exitCode);
}

if (require.main === module) {
  bootstrap().catch(() => process.exit(1));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { bootstrap, initializeCriticalSchemas, initializeServices, initializeWorkers, shutdown };
