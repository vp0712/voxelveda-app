const SENSITIVE_KEYS = /password|secret|token|authorization|cookie|bank|bsb|routing|account.?number|salary|payroll|tax.?id|mfa|recovery.?code|private.?key/i;
const SECRET_PATTERNS = [
  /\bvv_pat_[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi,
  /\b\d{6,12}\s*[- ]?\s*\d{6,12}\b/g
];

function sanitizeAiValue(value, key = '') {
  if (SENSITIVE_KEYS.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeAiValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeAiValue(child, childKey)]));
  if (typeof value !== 'string') return value;
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value).slice(0, 12000);
}

function enforceAiAction(action) {
  const blocked = new Set(['EXECUTE_PAYMENT', 'DELETE_USER', 'CHANGE_PERMISSION', 'POST_TRANSACTION', 'CHANGE_BANK_DETAILS']);
  if (blocked.has(String(action || '').trim().toUpperCase())) throw Object.assign(new Error('AI cannot execute this high-risk action'), { statusCode: 403 });
  return true;
}

module.exports = { enforceAiAction, sanitizeAiValue, SENSITIVE_KEYS };
