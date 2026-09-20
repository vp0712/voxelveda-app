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
const { getRateLimitService } = require('./services/rateLimitService');
const { healthCheck: malwareHealthCheck, scannerConfig } = require('./services/malwareScannerService');
const { healthProbe: objectStorageHealthProbe } = require('./services/objectStorageService');
const { selfTestWebhookVerifier } = require('./services/webhookSecurityService');
const { backgroundJobService } = require('./services/backgroundJobService');
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
const { ensureCareersSchema } = require('./services/careersSchema');
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
    ['enterprise_control_plane', 'Enterprise control plane schema ready.', () => ensureEnterpriseControlPlaneSchema()],
    ['careers', 'Careers recruitment schema ready.', () => ensureCareersSchema()]
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
  console.log('Provider assurance runtime checks: version=2026-09-21');
  const limiter = getRateLimitService();
  setControl('redis_limiter', CONTROL_STATES.INITIALIZING, 'Initializing configured rate-limit adapter');
  setCriticalService('rate_limiter', CONTROL_STATES.INITIALIZING);
  try {
    const limiterStatus = await limiter.initialize();
    const memoryInProduction = limiterStatus.provider === 'MEMORY' && process.env.NODE_ENV === 'production';
    const runtimeControlState = limiterStatus.distributed
      ? CONTROL_STATES.EXTERNALLY_VERIFIED
      : (memoryInProduction ? CONTROL_STATES.DEGRADED : CONTROL_STATES.OPERATIONAL);
    const detail = limiterStatus.distributed
      ? 'Redis adapter connected and completed a live PING/PONG provider health operation'
      : (memoryInProduction
        ? 'Memory limiter is active for a single replica; configure Redis before horizontal scaling'
        : 'Memory limiter is active for development or single-replica operation');
    setControl('redis_limiter', runtimeControlState, detail);
    setCriticalService('rate_limiter', limiterStatus.distributed ? CONTROL_STATES.OPERATIONAL : runtimeControlState, detail);
    console.log(`Rate limiter evidence: provider=${limiterStatus.provider} distributed=${limiterStatus.distributed ? 'yes' : 'no'} failure_policy=${limiterStatus.failure_policy} state=${runtimeControlState}`);
    if (memoryInProduction) addWarning('Rate limiting is process-local; keep one replica until a Redis provider is connected and health-verified');
  } catch (error) {
    setControl('redis_limiter', CONTROL_STATES.FAILED, error.code || 'RATE_LIMIT_INITIALIZATION_FAILED');
    setCriticalService('rate_limiter', CONTROL_STATES.FAILED, error.code || 'RATE_LIMIT_INITIALIZATION_FAILED');
    throw error;
  }

  const scannerConfigured = configured(['MALWARE_SCANNER_PROVIDER']);
  if (!scannerConfigured) {
    setControl('malware_scanner', CONTROL_STATES.NOT_CONFIGURED, 'No malware scanner provider configured');
  } else {
    setControl('malware_scanner', CONTROL_STATES.INITIALIZING, 'Verifying malware-scanner provider health');
    try {
      const scannerResult = await malwareHealthCheck(scannerConfig());
      if (!scannerResult?.ok) {
        const error = new Error('Malware scanner health operation failed');
        error.code = scannerResult?.code || 'MALWARE_SCANNER_HEALTH_FAILED';
        throw error;
      }
      setControl('malware_scanner', CONTROL_STATES.EXTERNALLY_VERIFIED, `Provider ${scannerResult.provider || process.env.MALWARE_SCANNER_PROVIDER} passed a live health operation`);
      console.log(`Malware scanner runtime evidence: ok=yes provider=${scannerResult.provider || process.env.MALWARE_SCANNER_PROVIDER}`);
    } catch (error) {
      setControl('malware_scanner', CONTROL_STATES.FAILED, error.code || 'MALWARE_SCANNER_HEALTH_FAILED');
      if (String(process.env.MALWARE_SCANNER_REQUIRED || '').toLowerCase() === 'true') throw error;
      addWarning('Malware scanner provider health could not be verified at runtime');
    }
  }

  const backupConfigured = String(process.env.BACKUP_STATUS_PROVIDER || '').toLowerCase() === 'configured';
  setControl('backup_provider', backupConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    backupConfigured ? 'Provider metadata is configured; current backup evidence is checked separately' : 'No backup provider adapter configured');

  const webhookConfigured = configured(['WEBHOOK_SIGNING_KEY']);
  if (!webhookConfigured) {
    setControl('webhook_signing', CONTROL_STATES.NOT_CONFIGURED, 'Webhook signing key not configured');
  } else {
    const webhookCheck = selfTestWebhookVerifier();
    setControl(
      'webhook_signing',
      webhookCheck.ok ? CONTROL_STATES.OPERATIONAL : CONTROL_STATES.FAILED,
      webhookCheck.ok ? webhookCheck.detail : `${webhookCheck.code}: ${webhookCheck.detail || 'Verifier self-test failed'}`
    );
    if (!webhookCheck.ok) addWarning('Signed webhook verifier failed its startup self-test; integration webhooks remain blocked');
  }

  setControl('outbound_request_policy', CONTROL_STATES.OPERATIONAL,
    `Deny-by-default outbound policy loaded with ${allowedHosts().size} allowlisted host(s)`);

  const canonicalConfigured = process.env.FORCE_CANONICAL_HOST === 'true';
  setControl('canonical_domain', canonicalConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    canonicalConfigured ? 'Canonical redirect configured; external DNS/TLS evidence not verified by this process' : 'Canonical redirect disabled');

  const webauthnConfigured = configured(['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN']);
  setControl('webauthn', webauthnConfigured ? CONTROL_STATES.CONFIGURED : CONTROL_STATES.NOT_CONFIGURED,
    webauthnConfigured ? 'WebAuthn settings present; no live ceremony adapter verified' : 'WebAuthn not configured');

  const objectStorageConfigured = configured(['OBJECT_STORAGE_PROVIDER']) || configured(['S3_BUCKET', 'S3_ENDPOINT']);
  if (!objectStorageConfigured) {
    setControl('object_storage', CONTROL_STATES.NOT_CONFIGURED, 'Durable object storage not configured');
  } else {
    setControl('object_storage', CONTROL_STATES.INITIALIZING, 'Verifying durable object-storage provider');
    try {
      const storageResult = await objectStorageHealthProbe();
      setControl('object_storage', CONTROL_STATES.EXTERNALLY_VERIFIED, `Provider ${storageResult.provider || process.env.OBJECT_STORAGE_PROVIDER} passed a live write/read/delete health operation`);
      console.log(`Object storage runtime evidence: ok=yes provider=${storageResult.provider || process.env.OBJECT_STORAGE_PROVIDER}`);
    } catch (error) {
      setControl('object_storage', CONTROL_STATES.FAILED, error.code || 'OBJECT_STORAGE_HEALTH_FAILED');
      if (String(process.env.OBJECT_STORAGE_REQUIRED || '').toLowerCase() === 'true') throw error;
      addWarning('Object storage provider health could not be verified at runtime');
    }
  }

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
  setCriticalService('background_workers', CONTROL_STATES.INITIALIZING);
  const framework = await backgroundJobService.initialize();
  const started = [
    startWeeklyTimesheetScheduler(),
    startTrashPurgeScheduler(),
    startWorkflowSlaScheduler(),
    startEmailQueueWorker()
  ].filter(Boolean).length;
  setCriticalService('background_workers', CONTROL_STATES.OPERATIONAL,
    `${framework.registered_jobs} jobs registered with durable MySQL leases; ${started} schedulers enabled`);
  console.log(`Background worker framework ready: ${framework.registered_jobs} jobs registered, ${started} schedulers enabled with durable MySQL leases.`);
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
    await getRateLimitService().close().catch(() => {});
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
  await getRateLimitService().close().catch(() => {});
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
