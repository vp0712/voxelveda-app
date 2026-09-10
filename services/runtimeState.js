const CONTROL_STATES = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURED: 'CONFIGURED',
  INITIALIZING: 'INITIALIZING',
  OPERATIONAL: 'OPERATIONAL',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  EXTERNALLY_VERIFIED: 'EXTERNALLY_VERIFIED'
});

const CONTROL_KEYS = Object.freeze([
  'redis_limiter', 'malware_scanner', 'smtp', 'backup_provider', 'database_tls',
  'database_least_privilege', 'webhook_signing', 'outbound_request_policy',
  'canonical_domain', 'webauthn', 'object_storage'
]);

function deploymentSha(env = process.env) {
  return String(env.RAILWAY_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.DEPLOYMENT_SHA || '').trim() || null;
}

function baseState() {
  return {
    started_at: new Date().toISOString(),
    ready_at: null,
    ready: false,
    phase: 'CREATED',
    failure: null,
    warnings: [],
    deployment_sha: deploymentSha(),
    database: {
      state: CONTROL_STATES.NOT_CONFIGURED,
      connected: false,
      tls_requested: false,
      tls_active: false,
      least_privilege_attested: false
    },
    migrations: {
      state: CONTROL_STATES.NOT_CONFIGURED,
      schema_version: null,
      applied: 0,
      skipped: 0
    },
    critical_services: {},
    controls: Object.fromEntries(CONTROL_KEYS.map((key) => [key, {
      state: CONTROL_STATES.NOT_CONFIGURED,
      checked_at: null,
      detail: null
    }]))
  };
}

let state = baseState();

function resetRuntimeState() {
  state = baseState();
  return state;
}

function setPhase(phase) {
  state.phase = String(phase || 'UNKNOWN').slice(0, 80);
}

function addWarning(warning) {
  const safe = String(warning || '').trim().slice(0, 500);
  if (safe && !state.warnings.includes(safe)) state.warnings.push(safe);
}

function setDatabase(details = {}) {
  state.database = { ...state.database, ...details };
}

function setMigrations(details = {}) {
  state.migrations = { ...state.migrations, ...details };
}

function setCriticalService(key, serviceState, detail = null) {
  state.critical_services[String(key)] = {
    state: serviceState,
    checked_at: new Date().toISOString(),
    detail: detail ? String(detail).slice(0, 240) : null
  };
}

function setControl(key, controlState, detail = null) {
  if (!CONTROL_KEYS.includes(key)) throw new Error(`Unknown runtime control: ${key}`);
  if (!Object.values(CONTROL_STATES).includes(controlState)) throw new Error(`Unknown control state: ${controlState}`);
  state.controls[key] = {
    state: controlState,
    checked_at: new Date().toISOString(),
    detail: detail ? String(detail).slice(0, 240) : null
  };
}

function markReady() {
  state.ready = true;
  state.ready_at = new Date().toISOString();
  state.phase = 'READY';
  state.failure = null;
}

function markFailed(error, phase = state.phase) {
  state.ready = false;
  state.phase = 'FAILED';
  state.failure = {
    phase: String(phase || 'UNKNOWN').slice(0, 80),
    code: String(error?.code || 'STARTUP_FAILED').slice(0, 80)
  };
}

function liveness() {
  return {
    status: 'ok',
    service: 'voxel-veda-app',
    deployment_sha: state.deployment_sha,
    uptime_seconds: Math.max(0, Math.floor(process.uptime()))
  };
}

function publicReadiness() {
  return {
    ready: state.ready,
    database: {
      state: state.database.state,
      connected: state.database.connected,
      tls_requested: state.database.tls_requested,
      tls_active: state.database.tls_active,
      least_privilege_attested: state.database.least_privilege_attested
    },
    schema_version: state.migrations.schema_version,
    critical_services: Object.fromEntries(Object.entries(state.critical_services).map(([key, value]) => [key, value.state])),
    deployment_sha: state.deployment_sha
  };
}

function detailedReadiness() {
  return JSON.parse(JSON.stringify({
    ...publicReadiness(),
    phase: state.phase,
    started_at: state.started_at,
    ready_at: state.ready_at,
    failure: state.failure,
    warnings: state.warnings,
    migrations: state.migrations,
    controls: state.controls,
    critical_service_details: state.critical_services
  }));
}

function controlSnapshot() {
  return JSON.parse(JSON.stringify(state.controls));
}

module.exports = {
  CONTROL_KEYS,
  CONTROL_STATES,
  addWarning,
  controlSnapshot,
  deploymentSha,
  detailedReadiness,
  liveness,
  markFailed,
  markReady,
  publicReadiness,
  resetRuntimeState,
  setControl,
  setCriticalService,
  setDatabase,
  setMigrations,
  setPhase
};
