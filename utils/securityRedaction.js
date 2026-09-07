const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|recovery|mfa|totp|ciphertext|bank.*(account|number)|account.*number|routing|bsb|api[_-]?key|private[_-]?key|security_answer)/i;

function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(?:gh[pousr]_|sk_live_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .slice(0, 4000);
}

function redactSensitive(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitive(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactString(value) : value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1)
  ]));
}

module.exports = { redactSensitive, redactString };
