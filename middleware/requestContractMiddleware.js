const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function findForbiddenKey(value, path = 'body', depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) return `${path}.${key}`;
    const nested = findForbiddenKey(child, `${path}.${key}`, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function bodyContract(allowedFields, { required = [], allowEmpty = false } = {}) {
  const allowed = new Set(allowedFields);
  const requiredFields = new Set(required);
  return (req, res, next) => {
    if (allowEmpty && req.body === undefined) req.body = {};
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ message: 'Request body must be a JSON object' });
    }
    const poisonKey = findForbiddenKey(req.body);
    if (poisonKey) return res.status(400).json({ message: 'Request contains a forbidden property' });
    const keys = Object.keys(req.body);
    if (!allowEmpty && !keys.length) return res.status(400).json({ message: 'Request body cannot be empty' });
    const unexpected = keys.filter((key) => !allowed.has(key));
    if (unexpected.length) {
      return res.status(400).json({
        message: 'Request contains unsupported fields',
        code: 'UNSUPPORTED_FIELDS',
        fields: unexpected.slice(0, 20)
      });
    }
    const missing = [...requiredFields].filter((key) => req.body[key] === undefined);
    if (missing.length) {
      return res.status(400).json({ message: 'Required fields are missing', code: 'REQUIRED_FIELDS_MISSING', fields: missing });
    }
    return next();
  };
}

module.exports = { bodyContract, findForbiddenKey };
