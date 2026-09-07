const pool = require('../config/db');
const { logSecurityEvent } = require('../services/sessionService');

function requireSensitiveExportApproval(exportType) {
  return async (req, res, next) => {
    if (process.env.DUAL_CONTROL_EXPORTS !== 'true') return next();
    const approvalId = String(req.get('x-vv-export-approval') || req.query.approval_id || '').trim();
    if (!approvalId) return res.status(403).json({ message: 'Independent export approval is required', code: 'EXPORT_APPROVAL_REQUIRED' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[approval]] = await connection.query('SELECT * FROM sensitive_export_requests WHERE id = ? FOR UPDATE', [approvalId]);
      if (!approval || approval.status !== 'APPROVED' || approval.export_type !== exportType || approval.consumed_at || new Date(approval.expires_at) <= new Date()) {
        await connection.rollback();
        return res.status(403).json({ message: 'Export approval is invalid, expired or already used' });
      }
      if (Number(approval.requested_by) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'Only the original requester can consume this export approval' });
      }
      await connection.query("UPDATE sensitive_export_requests SET status='CONSUMED', consumed_at=NOW() WHERE id=?", [approval.id]);
      await connection.commit();
      req.sensitiveExportApproval = approval.id;
      await logSecurityEvent({ actorId: req.user.id, eventType: 'SENSITIVE_EXPORT_APPROVAL_CONSUMED', req, sessionId: req.session?.id, metadata: { approval_id: approval.id, export_type: exportType } });
      return next();
    } catch (error) {
      await connection.rollback().catch(() => {});
      return next(error);
    } finally { connection.release(); }
  };
}

module.exports = requireSensitiveExportApproval;
