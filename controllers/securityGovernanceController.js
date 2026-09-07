const crypto = require('crypto');
const pool = require('../config/db');
const { HIGH_RISK_PERMISSIONS, PERMISSIONS } = require('../config/permissionCatalog');
const { logAudit } = require('../services/auditService');
const { ensureSecurityGovernanceSchema } = require('../services/securityGovernanceSchema');
const { hashToken } = require('../services/securityContextService');
const { logSecurityEvent } = require('../services/sessionService');
const { verifyAuditChain } = require('../services/auditIntegrityService');

const FINANCE_DELEGATION_BLOCKLIST = new Set([
  'VIEW_FINANCE', 'EDIT_FINANCE', 'POST_TRANSACTION', 'VOID_TRANSACTION', 'OVERRIDE_TAX',
  'VIEW_BANKING', 'VIEW_BANK_DETAILS', 'EDIT_BANK_DETAILS', 'APPROVE_PAYMENT', 'EXPORT_ABA',
  'VIEW_PAYROLL', 'EDIT_PAYROLL', 'VIEW_PAYROLL_BANKING', 'APPROVE_PAYROLL_BANK_CHANGE',
  'EXPORT_FINANCIAL_DATA'
]);

const text = (value, max) => String(value || '').trim().slice(0, max);
const upperList = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 100).toUpperCase()).filter(Boolean))];

async function audit(req, action, type, id, metadata = {}, targetUserId = null) {
  await logAudit(pool, {
    actorId: req.user.id, action, module: 'security_governance', recordType: type, recordId: id,
    newValue: metadata, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.requestId,
    sessionId: req.session?.id, metadata
  });
  await logSecurityEvent({ actorId: req.user.id, targetUserId, eventType: action, req, sessionId: req.session?.id, metadata });
}

exports.summary = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const [sets, chain] = await Promise.all([Promise.all([
      pool.query("SELECT COUNT(*) count FROM break_glass_requests WHERE status='ACTIVE' AND expires_at>NOW()"),
      pool.query("SELECT COUNT(*) count FROM break_glass_requests WHERE status='PENDING_APPROVAL' AND expires_at>NOW()"),
      pool.query("SELECT COUNT(*) count FROM impersonation_contexts WHERE status='ACTIVE' AND ended_at IS NULL AND expires_at>NOW()"),
      pool.query("SELECT COUNT(*) count FROM database_security_attestations WHERE status='VERIFIED' AND least_privilege_verified=1 AND expires_at>NOW()"),
      pool.query("SELECT COUNT(*) count FROM sensitive_data_registry WHERE status='ACTIVE'"),
      pool.query("SELECT COUNT(*) total,SUM(integrity_hash IS NOT NULL) chained FROM audit_logs WHERE created_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)"),
      pool.query("SELECT COUNT(*) count FROM users WHERE active=1 AND deleted_at IS NULL AND COALESCE(last_login_at,created_at)<DATE_SUB(NOW(),INTERVAL 60 DAY)"),
      pool.query("SELECT COUNT(*) count FROM users WHERE active=1 AND deleted_at IS NULL AND COALESCE(last_login_at,created_at)<DATE_SUB(NOW(),INTERVAL 90 DAY)")
    ]), verifyAuditChain(5000)]);
    const count = (index, key = 'count') => Number(sets[index][0][0]?.[key] || 0);
    const totalAudit = count(5, 'total');
    const chainedAudit = count(5, 'chained');
    const controls = {
      request_contracts: true,
      settings_secret_boundary: true,
      audit_hash_chain: (totalAudit === 0 || chainedAudit === totalAudit) && chain.valid,
      database_least_privilege_attested: count(3) > 0,
      sensitive_data_registry: count(4) >= 8,
      break_glass_dual_control: true,
      impersonation_read_only: true,
      termination_transfer_control: true
    };
    const verified = Object.values(controls).filter(Boolean).length;
    return res.json({
      generated_at: new Date().toISOString(),
      metrics: {
        active_break_glass: count(0), pending_break_glass: count(1), active_impersonations: count(2),
        current_database_attestations: count(3), sensitive_fields_registered: count(4),
        audit_chain_coverage: totalAudit ? Math.round((chainedAudit / totalAudit) * 100) : 100,
        audit_chain_checked_records: chain.checked_records,
        stale_accounts_60d: count(6), stale_accounts_90d: count(7)
      },
      controls,
      readiness: {
        score: Math.round((verified / Object.keys(controls).length) * 100),
        disclaimer: 'Governance coverage indicator only; not a certification or penetration-test result.'
      }
    });
  } catch (error) { next(error); }
};

exports.verifyAuditIntegrity = async (req, res, next) => {
  try {
    const result = await verifyAuditChain(10000);
    return res.status(result.valid ? 200 : 409).json({
      ...result,
      disclaimer: result.window_limited ? 'The most recent 10,000 chained records were verified.' : 'Every chained audit record was verified.'
    });
  } catch (error) { next(error); }
};

exports.catalog = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const sets = await Promise.all([
      pool.query(`SELECT bg.id,bg.beneficiary_user_id,u.name beneficiary_name,bg.permissions_json,bg.incident_reference,
        bg.reason,bg.status,bg.requested_by,bg.approved_by,bg.requested_at,bg.approved_at,bg.expires_at,bg.revoked_at
        FROM break_glass_requests bg LEFT JOIN users u ON u.id=bg.beneficiary_user_id ORDER BY bg.requested_at DESC LIMIT 100`),
      pool.query(`SELECT ic.id,ic.actor_user_id,a.name actor_name,ic.target_user_id,t.name target_name,ic.reason,
        ic.status,ic.created_at,ic.expires_at,ic.ended_at FROM impersonation_contexts ic
        LEFT JOIN users a ON a.id=ic.actor_user_id LEFT JOIN users t ON t.id=ic.target_user_id
        ORDER BY ic.created_at DESC LIMIT 100`),
      pool.query(`SELECT id,database_identity,privilege_scope,tls_in_use,least_privilege_verified,
        provider_evidence_reference,status,attested_by,reviewed_at,expires_at,created_at
        FROM database_security_attestations ORDER BY reviewed_at DESC LIMIT 50`),
      pool.query(`SELECT record_type,field_name,classification,protection_method,key_name,status,reviewed_at
        FROM sensitive_data_registry ORDER BY classification DESC,record_type,field_name`),
      pool.query(`SELECT id,source_user_id,destination_user_id,transfer_reason,transferred_counts_json,transferred_by,created_at
        FROM ownership_transfer_events ORDER BY created_at DESC LIMIT 100`)
    ]);
    return res.json({
      break_glass: sets[0][0], impersonations: sets[1][0], database_attestations: sets[2][0],
      sensitive_data_registry: sets[3][0], ownership_transfers: sets[4][0]
    });
  } catch (error) { next(error); }
};

exports.requestBreakGlass = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const beneficiaryId = Number(req.body.beneficiary_user_id);
    const permissions = upperList(req.body.permissions);
    const incident = text(req.body.incident_reference, 120);
    const reason = text(req.body.reason, 1000);
    const minutes = Number(req.body.duration_minutes || 30);
    if (!beneficiaryId || beneficiaryId === Number(req.user.id) || !incident || reason.length < 30 ||
      !Number.isInteger(minutes) || minutes < 5 || minutes > 60 || !permissions.length ||
      permissions.some((permission) => !PERMISSIONS.includes(permission) || FINANCE_DELEGATION_BLOCKLIST.has(permission))) {
      return res.status(400).json({ message: 'A different beneficiary, incident reference, detailed reason, safe permissions and 5-60 minute duration are required' });
    }
    const [[beneficiary]] = await pool.query(
      'SELECT id,role,active,account_status,mfa_enabled FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1', [beneficiaryId]
    );
    if (!beneficiary || !beneficiary.active || Number(beneficiary.mfa_enabled) !== 1 ||
      ['LOCKED', 'SUSPENDED', 'DISABLED', 'TERMINATED'].includes(String(beneficiary.account_status).toUpperCase())) {
      return res.status(409).json({ message: 'Beneficiary must be an active MFA-enrolled user' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO break_glass_requests
       (id,beneficiary_user_id,permissions_json,incident_reference,reason,requested_by,expires_at)
       VALUES (?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))`,
      [id, beneficiaryId, JSON.stringify(permissions), incident, reason, req.user.id, minutes]
    );
    await audit(req, 'BREAK_GLASS_REQUESTED', 'break_glass', id, { beneficiary_user_id: beneficiaryId, permissions, incident_reference: incident, duration_minutes: minutes }, beneficiaryId);
    return res.status(201).json({ id, status: 'PENDING_APPROVAL', message: 'A different super administrator must approve this request before it becomes active.' });
  } catch (error) { next(error); }
};

exports.approveBreakGlass = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const reason = text(req.body.approval_reason, 500);
    const [[item]] = await pool.query('SELECT * FROM break_glass_requests WHERE id=? LIMIT 1', [req.params.id]);
    if (!item) return res.status(404).json({ message: 'Break-glass request not found' });
    if ([item.requested_by, item.beneficiary_user_id].some((id) => Number(id) === Number(req.user.id))) {
      return res.status(403).json({ message: 'Requester and beneficiary cannot approve break-glass access' });
    }
    if (item.status !== 'PENDING_APPROVAL' || new Date(item.expires_at) <= new Date()) return res.status(409).json({ message: 'Break-glass request is not approvable' });
    if (reason.length < 20 || req.body.confirmation !== 'ACTIVATE EMERGENCY ACCESS') return res.status(400).json({ message: 'Detailed approval reason and exact confirmation are required' });
    const [result] = await pool.query(
      `UPDATE break_glass_requests SET status='ACTIVE',approved_by=?,approved_at=NOW(),activated_at=NOW()
       WHERE id=? AND status='PENDING_APPROVAL' AND expires_at>NOW()`, [req.user.id, item.id]
    );
    if (!result.affectedRows) return res.status(409).json({ message: 'Break-glass request changed before approval' });
    await audit(req, 'BREAK_GLASS_ACTIVATED', 'break_glass', item.id, { beneficiary_user_id: item.beneficiary_user_id, incident_reference: item.incident_reference, expires_at: item.expires_at, approval_reason: reason }, item.beneficiary_user_id);
    return res.json({ message: 'Emergency access activated with a fixed expiry.', expires_at: item.expires_at });
  } catch (error) { next(error); }
};

exports.revokeBreakGlass = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const reason = text(req.body.reason, 500);
    if (reason.length < 10) return res.status(400).json({ message: 'Revocation reason is required' });
    const [result] = await pool.query(
      `UPDATE break_glass_requests SET status='REVOKED',revoked_by=?,revoked_at=NOW(),revoke_reason=?
       WHERE id=? AND status IN ('ACTIVE','PENDING_APPROVAL')`, [req.user.id, reason, req.params.id]
    );
    if (!result.affectedRows) return res.status(409).json({ message: 'Break-glass request is not active or pending' });
    await audit(req, 'BREAK_GLASS_REVOKED', 'break_glass', req.params.id, { reason });
    return res.json({ message: 'Break-glass access revoked immediately.' });
  } catch (error) { next(error); }
};

exports.startImpersonation = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    if (String(req.user.role).toLowerCase() !== 'super_admin') return res.status(403).json({ message: 'Only a super administrator can start read-only support impersonation' });
    const targetId = Number(req.body.target_user_id);
    const reason = text(req.body.reason, 700);
    const minutes = Number(req.body.duration_minutes || 10);
    if (!targetId || targetId === Number(req.user.id) || reason.length < 30 || !Number.isInteger(minutes) || minutes < 1 || minutes > 15) {
      return res.status(400).json({ message: 'A different target, detailed support reason and 1-15 minute duration are required' });
    }
    const [[target]] = await pool.query('SELECT id,role,active,account_status FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1', [targetId]);
    if (!target || !target.active || String(target.role).toLowerCase() === 'super_admin' || ['LOCKED','SUSPENDED','DISABLED','TERMINATED'].includes(String(target.account_status).toUpperCase())) {
      return res.status(409).json({ message: 'Target must be an active non-super-administrator account' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO impersonation_contexts
       (id,context_token_hash,actor_user_id,actor_session_id,target_user_id,reason,expires_at)
       VALUES (?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? MINUTE))`,
      [id, hashToken(token), req.user.id, req.session.id, targetId, reason, minutes]
    );
    await audit(req, 'IMPERSONATION_STARTED', 'impersonation', id, { target_user_id: targetId, mode: 'READ_ONLY', duration_minutes: minutes }, targetId);
    return res.status(201).json({
      id, context_token: token, mode: 'READ_ONLY', expires_in_minutes: minutes,
      warning: 'This token is displayed once. Send it only in X-Impersonation-Context from the current administrator session.'
    });
  } catch (error) { next(error); }
};

exports.endImpersonation = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const reason = text(req.body.reason, 500);
    if (reason.length < 10) return res.status(400).json({ message: 'End reason is required' });
    const [result] = await pool.query(
      `UPDATE impersonation_contexts SET status='ENDED',ended_at=NOW(),ended_by=?
       WHERE id=? AND actor_user_id=? AND status='ACTIVE'`, [req.user.id, req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Active impersonation context not found for this administrator' });
    await audit(req, 'IMPERSONATION_ENDED', 'impersonation', req.params.id, { reason });
    return res.json({ message: 'Impersonation context ended.' });
  } catch (error) { next(error); }
};

exports.attestDatabaseSecurity = async (req, res, next) => {
  try {
    await ensureSecurityGovernanceSchema();
    const identity = text(req.body.database_identity, 160);
    const scope = text(req.body.privilege_scope, 500);
    const evidence = text(req.body.provider_evidence_reference, 500);
    const status = text(req.body.status, 30).toUpperCase();
    const days = Number(req.body.valid_for_days || 90);
    if (identity.length < 3 || scope.length < 20 || evidence.length < 10 || !['VERIFIED','REMEDIATION_REQUIRED'].includes(status) || !Number.isInteger(days) || days < 1 || days > 180 || typeof req.body.tls_in_use !== 'boolean' || typeof req.body.least_privilege_verified !== 'boolean') {
      return res.status(400).json({ message: 'Complete provider-backed database security evidence and a 1-180 day review period are required' });
    }
    if (status === 'VERIFIED' && (!req.body.tls_in_use || !req.body.least_privilege_verified)) {
      return res.status(400).json({ message: 'Verified status requires TLS and least-privilege confirmation' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO database_security_attestations
       (id,database_identity,privilege_scope,tls_in_use,least_privilege_verified,provider_evidence_reference,status,attested_by,reviewed_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,NOW(),DATE_ADD(NOW(),INTERVAL ? DAY))`,
      [id, identity, scope, req.body.tls_in_use ? 1 : 0, req.body.least_privilege_verified ? 1 : 0, evidence, status, req.user.id, days]
    );
    await audit(req, 'DATABASE_SECURITY_ATTESTED', 'database_attestation', id, { database_identity: identity, tls_in_use: req.body.tls_in_use, least_privilege_verified: req.body.least_privilege_verified, status, valid_for_days: days, evidence_reference: evidence });
    return res.status(201).json({ id, status, expires_in_days: days, message: 'Database posture evidence recorded. No database credential or grant text was stored.' });
  } catch (error) { next(error); }
};

exports.FINANCE_DELEGATION_BLOCKLIST = FINANCE_DELEGATION_BLOCKLIST;
