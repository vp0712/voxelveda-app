const pool = require('../config/db');
const { ensureSecurityOperationsSchema } = require('../services/securityOperationsSchema');

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function safeLocation(value) {
  const raw = clean(value, 1000);
  if (!raw) return null;
  if (/^(data|blob|inline|eval):/i.test(raw)) return raw.split(':')[0].toLowerCase();
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 255);
  } catch { return null; }
}

exports.recordCspViolation = async (req, res, next) => {
  try {
    await ensureSecurityOperationsSchema();
    const report = req.body?.['csp-report'] || req.body || {};
    const directive = clean(report['violated-directive'] || report.violatedDirective, 120);
    if (!directive) return res.status(204).end();
    await pool.query(
      `INSERT INTO security_policy_violations
       (request_id,document_origin,blocked_origin,violated_directive,effective_directive,disposition,source_file,line_number,user_agent)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.requestId || null, safeLocation(report['document-uri'] || report.documentURL),
        safeLocation(report['blocked-uri'] || report.blockedURL), directive,
        clean(report['effective-directive'] || report.effectiveDirective, 120) || null,
        clean(report.disposition, 20) || null, safeLocation(report['source-file'] || report.sourceFile),
        Math.max(0, Math.min(10000000, Number(report['line-number'] || report.lineNumber || 0))) || null,
        clean(req.get('user-agent'), 255) || null]
    );
    return res.status(204).end();
  } catch (error) { return next(error); }
};

module.exports.safeLocation = safeLocation;
