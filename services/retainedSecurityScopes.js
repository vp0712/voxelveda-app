'use strict';
const { PERMISSIONS } = require('../config/permissionCatalog');
const RETAINED_EXPORT_TYPES = Object.freeze(['STAFF', 'CUSTOMERS', 'PAYROLL']);
const SCOPE_FIELDS = new Set(['module','linked_module','export_type','entity_type','record_type','scope_type','scope_id','scope','source_key','event_type','allowed_events','event_types','allowed_events_json','event_types_json','control_key','change_type','action','action_key','key_name','secret_name','account_name']);
const PERMISSION_FIELDS = new Set(['permission','permission_name','permission_a','permission_b','permissions','permissions_json','scopes','scopes_json']);
const JSON_FIELDS = new Set(['parameters_json','scope_json','permissions_json','scopes_json','allowed_events_json','event_types_json','event_payload']);
function retiredEntity(value) {
  return typeof value === 'string' && /(?:^|[_:/\.\s-])(?:BANKING|BANK|FINANCE|FINANCIAL|ERP|TREASURY|PERSONAL_FINANCE|ABA)(?:$|[_:/\.\s-])/i.test(value);
}
function retainedPermission(value) { return typeof value === 'string' && PERMISSIONS.includes(value.toUpperCase()); }
function retainedExportType(value) { return RETAINED_EXPORT_TYPES.includes(String(value || '').toUpperCase()); }
function hasRetiredScope(value, field = '') {
  if (typeof value === 'string') {
    if (JSON_FIELDS.has(field)) { try { return hasRetiredScope(JSON.parse(value), field); } catch { return true; } }
    return PERMISSION_FIELDS.has(field) ? !retainedPermission(value) && retiredEntity(value) : SCOPE_FIELDS.has(field) && retiredEntity(value);
  }
  if (Array.isArray(value)) return value.some(item => hasRetiredScope(item, field));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => hasRetiredScope(item, key.toLowerCase()));
}
function rejectRetiredSecurityScope(req, res, next) {
  if (hasRetiredScope(req.body) || hasRetiredScope(req.query)) return res.status(410).json({ message: 'The Banking/Finance system and separate ERP portal remain retired. This shared security action cannot target those systems.', code: 'APPLICATION_MODULE_RETIRED' });
  return next();
}
function filterScopedRows(rows) { return rows.filter(row => !hasRetiredScope(row)); }
module.exports = { RETAINED_EXPORT_TYPES, retiredEntity, retainedPermission, retainedExportType, hasRetiredScope, rejectRetiredSecurityScope, filterScopedRows };
