const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|recovery|mfa|totp|bank.*(account|number)|account.*number|routing|bsb|api[_-]?key|private[_-]?key)/i;

function redactSensitive(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitive(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 4000) : value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1)
  ]));
}

module.exports = { redactSensitive };
