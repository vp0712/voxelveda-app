'use strict';

function externalHttpUrl(value, field) {
  if (value === undefined || value === null || value === '') return '';
  const message = 'Use a complete HTTP or HTTPS link without embedded credentials.';
  const invalid = () => Object.assign(new Error(message), { statusCode: 400, code: 'VALIDATION_FAILED', fields: { [field]: message } });
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  const text = value.trim();
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw invalid();
  return parsed.href;
}

module.exports = { externalHttpUrl };
