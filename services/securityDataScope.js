'use strict';

// Historical audit entries remain untouched, including their integrity chain.
// Active security views and retention jobs use the same explicit boundary.
const RETAINED_AUDIT_MODULES = Object.freeze(['security', 'profile', 'settings', 'auth', 'authentication', 'users', 'authorization']);
const RETAINED_EVENT_TYPES = Object.freeze([
  'LOGIN_FAILURE', 'LOGIN_SUCCESS', 'MFA_SETUP_REQUIRED', 'MFA_CHALLENGE_ISSUED',
  'MFA_FAILED', 'MFA_ENABLED', 'MFA_DISABLED', 'MFA_VERIFIED', 'MFA_RECOVERY_CODE_USED',
  'MFA_ENROLLMENT_STARTED', 'RECOVERY_CODES_REGENERATED', 'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET', 'PASSWORD_CHANGED', 'INVITATION_ACCEPTED', 'USER_INVITED',
  'INVITATION_REVOKED', 'INVITATION_REISSUED', 'ROLE_CHANGED', 'PERMISSION_CHANGED',
  'ROLE_OR_PERMISSION_CHANGED', 'USER_ACTIVE', 'USER_DISABLED', 'USER_LOCKED',
  'USER_TERMINATED', 'ACCOUNT_TERMINATED', 'ACCOUNT_COMPROMISED',
  'SESSION_REVOKED', 'OTHER_SESSIONS_REVOKED', 'ORGANISATION_SESSIONS_REVOKED',
  'PRIVILEGED_ACCESS_REVIEWED', 'PROFILE_PHOTO_UPDATED', 'PROFILE_PHOTO_REMOVED',
  'STEP_UP_FAILED', 'STEP_UP_VERIFIED', 'STEP_UP_REQUIRED', 'SECURITY_SETTING_CHANGED',
  'SECURITY_INCIDENT_OPENED', 'SECURITY_INCIDENT_STATUS_CHANGED',
  'INCIDENT_ACCOUNT_CONTAINED', 'INCIDENT_RECOVERY_INITIATED', 'SECURITY_REPORT_EXPORTED',
  'SENSITIVE_DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOAD_GRANT_CREATED',
  'BREAK_GLASS_ACTIVATED', 'BREAK_GLASS_ACCESS_USED', 'IMPERSONATION_STARTED',
  'IMPERSONATION_ACCESS_USED', 'DATABASE_SECURITY_ATTESTED', 'DB_CAPACITY_PROBE'
]);
const RETAINED_HIGH_RISK_EVENTS = Object.freeze([
  'ROLE_CHANGED', 'PERMISSION_CHANGED', 'ROLE_OR_PERMISSION_CHANGED', 'USER_DISABLED',
  'USER_TERMINATED', 'ACCOUNT_TERMINATED', 'ACCOUNT_COMPROMISED', 'MFA_DISABLED',
  'SECURITY_SETTING_CHANGED', 'BREAK_GLASS_ACTIVATED', 'IMPERSONATION_STARTED',
  'DATABASE_SECURITY_ATTESTED', 'ORGANISATION_SESSIONS_REVOKED', 'SECURITY_REPORT_EXPORTED'
]);

function prefix(alias) {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid security scope alias');
  return alias ? `${alias}.` : '';
}
function placeholders(values) { return values.map(() => '?').join(','); }
function retainedAuditScope(alias = '') {
  const column = prefix(alias);
  return { sql: `LOWER(${column}module) IN (${placeholders(RETAINED_AUDIT_MODULES)})`, params: [...RETAINED_AUDIT_MODULES] };
}
function retainedEventScope(alias = '') {
  const column = prefix(alias);
  const clauses = [`${column}event_type IN (${placeholders(RETAINED_EVENT_TYPES)})`];
  const params = [...RETAINED_EVENT_TYPES];
  const metadataFields = {
    module: RETAINED_AUDIT_MODULES,
    scope: ['account', 'user', 'users', 'security', 'profile', 'settings', 'auth', 'authentication', 'authorization', 'organisation', 'organization', 'application'],
    recordType: ['user', 'profile', 'profile_photo', 'auth_session', 'security_report', 'security_incident', 'settings', 'security'],
    record_type: ['user', 'profile', 'profile_photo', 'auth_session', 'security_report', 'security_incident', 'settings', 'security'],
    export_type: ['security_report']
  };
  for (const [field, values] of Object.entries(metadataFields)) {
    // JSON is a typed column. A missing scope is acceptable for identity events;
    // an explicit unknown or retired scope is deliberately unavailable.
    const json = `JSON_EXTRACT(${column}metadata_json, '$.${field}')`;
    clauses.push(`(${json} IS NULL OR LOWER(JSON_UNQUOTE(${json})) IN (${placeholders(values)}))`);
    params.push(...values);
  }
  const stepUpActions = ["ADMIN_PASSWORD_RESET", "CHANGE_ROLE_OR_PERMISSIONS", "CHANGE_SECURITY_INCIDENT_STATUS", "CHANGE_SYSTEM_SETTINGS", "CHANGE_USER_RECORD", "CONTAIN_COMPROMISED_ACCOUNT", "CREATE_DOCUMENT_DOWNLOAD_GRANT", "CREATE_USER", "EXPORT_SECURITY_REPORT", "INITIATE_ACCOUNT_RECOVERY", "MARK_ACCOUNT_COMPROMISED", "OPEN_SECURITY_INCIDENT", "RESEND_USER_INVITATION", "RETRY_BACKGROUND_JOB", "REVIEW_PRIVILEGED_ACCESS", "REVOKE_ORGANISATION_SESSIONS", "REVOKE_USER_INVITATION", "REVOKE_USER_SESSIONS", "TERMINATE_USER_ACCESS"];
  const action = `JSON_EXTRACT(${column}metadata_json, '$.action')`;
  clauses.push(`(${column}event_type <> 'STEP_UP_REQUIRED' OR ${action} IS NULL OR UPPER(JSON_UNQUOTE(${action})) IN (${placeholders(stepUpActions)}))`);
  params.push(...stepUpActions);
  return { sql: clauses.join(' AND '), params };
}

module.exports = { RETAINED_AUDIT_MODULES, RETAINED_EVENT_TYPES, RETAINED_HIGH_RISK_EVENTS, retainedAuditScope, retainedEventScope };
