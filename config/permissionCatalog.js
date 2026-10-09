// Active capabilities belong to the retained account and security foundation.
// Historical role IDs and permission strings remain in stored records; they do
// not grant retired module access or become new administration permissions.
const PERMISSIONS = Object.freeze([
  'MANAGE_USERS', 'MANAGE_ROLES', 'MANAGE_SECURITY', 'VIEW_AUDIT_LOG',
  'MANAGE_SECURITY_INCIDENTS', 'EXPORT_SECURITY_REPORT', 'REVOKE_ORGANISATION_SESSIONS',
  'MANAGE_API_TOKENS', 'MANAGE_WEBHOOKS', 'MANAGE_DATA_RETENTION', 'AUTHORISE_SENSITIVE_EXPORT',
  'MANAGE_SECRET_ROTATION', 'MANAGE_BACKUP_ATTESTATIONS', 'MANAGE_MALWARE_QUARANTINE',
  'VIEW_SECURITY_EVIDENCE', 'VIEW_SECURITY_GOVERNANCE', 'MANAGE_BREAK_GLASS',
  'USE_SUPPORT_IMPERSONATION', 'ATTEST_DATABASE_SECURITY', 'MANAGE_BACKGROUND_JOBS',
  'VIEW_CONFIDENTIAL_FILES'
]);

const HIGH_RISK_PERMISSIONS = new Set(PERMISSIONS.filter((permission) => ![
  'VIEW_AUDIT_LOG', 'VIEW_CONFIDENTIAL_FILES'
].includes(permission)));

const ROLE_TEMPLATES = Object.freeze(Object.assign(Object.create(null), {
  super_admin: PERMISSIONS,
  // Exact retained intersection of the former administrator template.
  admin: Object.freeze(['MANAGE_USERS', 'MANAGE_ROLES', 'VIEW_AUDIT_LOG', 'MANAGE_BACKGROUND_JOBS', 'VIEW_CONFIDENTIAL_FILES']),
  staff: Object.freeze([]),
  viewer: Object.freeze([]),
  view_only: Object.freeze([])
}));

// Operational UI flags are no longer authority aliases. Explicit retained
// canonical grants continue to be evaluated without changing stored values.
const LEGACY_PERMISSION_MAP = Object.freeze({});

module.exports = { HIGH_RISK_PERMISSIONS, LEGACY_PERMISSION_MAP, PERMISSIONS, ROLE_TEMPLATES };
