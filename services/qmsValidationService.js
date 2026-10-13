function normalizeDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return { fields: [] };
  const fields = Array.isArray(definition.fields) ? definition.fields : [];
  return { ...definition, fields };
}

function isEmpty(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function conditionMatches(condition, values) {
  if (!condition) return true;
  if (typeof condition === 'string') return Boolean(values[condition]);
  if (typeof condition !== 'object') return true;
  const actual = values[condition.field];
  if ('equals' in condition) return actual === condition.equals;
  if ('not_equals' in condition) return actual !== condition.not_equals;
  if ('in' in condition && Array.isArray(condition.in)) return condition.in.includes(actual);
  if ('present' in condition) return condition.present ? !isEmpty(actual) : isEmpty(actual);
  return true;
}

function validateField(field, value, values, evidenceByField = {}) {
  const errors = [];
  const required = Boolean(field.required) || Boolean(field.required_when && conditionMatches(field.required_when, values));
  if (required && isEmpty(value)) errors.push('required');
  if (isEmpty(value)) return errors;

  const type = String(field.type || 'text');
  if (['number','decimal'].includes(type) && Number.isNaN(Number(value))) errors.push('must be numeric');
  if (type === 'boolean' && ![true,false,'true','false',0,1,'0','1'].includes(value)) errors.push('must be boolean');
  if (field.min !== undefined && Number(value) < Number(field.min)) errors.push(`must be >= ${field.min}`);
  if (field.max !== undefined && Number(value) > Number(field.max)) errors.push(`must be <= ${field.max}`);
  if (field.regex) {
    try { if (!new RegExp(field.regex).test(String(value))) errors.push('invalid format'); } catch { errors.push('invalid validation rule'); }
  }
  if (Array.isArray(field.allowed_values) && field.allowed_values.length) {
    if (type === 'multi-select') {
      if (!Array.isArray(value) || value.some((item) => !field.allowed_values.includes(item))) errors.push('contains an unsupported value');
    } else if (!field.allowed_values.includes(value)) errors.push('unsupported value');
  }
  const evidence = evidenceByField[field.key] || evidenceByField['*'] || [];
  if (field.requires_evidence && !evidence.length) errors.push('evidence required');
  return errors;
}

function validateRecord(definition, values, options = {}) {
  const normalized = normalizeDefinition(definition);
  const input = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const issues = [];
  let blockingIssues = 0;

  for (const rawField of normalized.fields) {
    const field = { ...rawField, key: String(rawField.key || rawField.id || rawField.label || '').trim() };
    if (!field.key) continue;
    const fieldErrors = validateField(field, input[field.key], input, options.evidenceByField || {});
    for (const error of fieldErrors) {
      const blocking = Boolean(field.blocking || field.required || field.required_when || (field.requires_evidence && field.blocking !== false));
      if (blocking) blockingIssues += 1;
      issues.push({ field: field.key, label: field.label || field.key, error, blocking });
    }
  }

  return { valid: issues.length === 0, blockingValid: blockingIssues === 0, blockingIssues, issues };
}

function assertTransitionValidation({ targetStatus, definition, values, evidenceByField }) {
  const target = String(targetStatus || '').toUpperCase();
  const guarded = new Set(['SUBMITTED','UNDER_REVIEW','APPROVED','CLOSED']);
  if (!guarded.has(target)) return { valid: true, blockingValid: true, blockingIssues: 0, issues: [] };
  return validateRecord(definition, values, { evidenceByField });
}

module.exports = { normalizeDefinition, validateRecord, assertTransitionValidation, conditionMatches };
