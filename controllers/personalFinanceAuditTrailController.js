'use strict';

const pool = require('../config/db');
const { ensureSecurityGovernanceSchema } = require('../services/securityGovernanceSchema');

function userId(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return Number(value);
}
function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function fail(res, error) {
  const status = Number(error?.statusCode || 500);
  if (status >= 500) console.error('Failed to load Personal Finance Audit Trail.', error);
  return res.status(status).json({ message: status >= 500 ? 'Failed to load Personal Finance Audit Trail.' : error.message });
}
function humanAction(action) {
  return String(action || '').toLowerCase().split('_').filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
}

exports.getTrail = async (req, res) => {
  try {
    await ensureSecurityGovernanceSchema();
    const uid = userId(req);
    const limit = Math.min(500, Math.max(25, Number(req.query.limit || 250)));
    const [rows] = await pool.query(
      `SELECT al.id,al.actor_id,al.action,al.module,al.record_type,al.record_id,al.old_value,al.new_value,
              al.request_id,al.session_id,al.result,al.metadata_json,al.previous_integrity_hash,al.integrity_hash,al.created_at,
              bt.transaction_date,bt.description,bt.merchant_name,bt.currency,bt.debit,bt.credit,bt.category,
              bt.classification_status,bt.is_internal_transfer,bt.reconciliation_status,
              ba.nickname AS account_name
         FROM audit_logs al
         JOIN bank_transactions bt ON al.record_type='bank_transaction' AND CAST(al.record_id AS UNSIGNED)=bt.id
         JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE al.actor_id=?
          AND ba.created_by=?
          AND ba.ownership_scope='PERSONAL'
          AND bt.ownership_scope='PERSONAL'
        ORDER BY al.created_at DESC,al.id DESC
        LIMIT ?`,
      [uid, uid, limit]
    );

    const events = rows.map((r) => {
      const amount = Number(r.credit || 0) - Number(r.debit || 0);
      const stepUpRequired = String(r.action || '').toUpperCase() === 'RECONCILIATION_CLASSIFIED';
      return {
        id: Number(r.id),
        created_at: r.created_at,
        actor: { id: Number(r.actor_id), label: 'You' },
        action: r.action,
        action_label: humanAction(r.action),
        module: r.module,
        record_type: r.record_type,
        record_id: String(r.record_id || ''),
        result: r.result || 'SUCCESS',
        old_value: parseJson(r.old_value),
        new_value: parseJson(r.new_value),
        metadata: parseJson(r.metadata_json),
        request_id: r.request_id || null,
        session_id: r.session_id || null,
        integrity: {
          present: Boolean(r.integrity_hash),
          hash_prefix: r.integrity_hash ? String(r.integrity_hash).slice(0, 12) : null,
          previous_hash_recorded: Boolean(r.previous_integrity_hash)
        },
        step_up_context: stepUpRequired ? 'Step-up authentication is required by the route for this action.' : 'Step-up status is not universally recorded on this audit row.',
        transaction: {
          date: r.transaction_date,
          account_name: r.account_name,
          description: r.description || r.merchant_name || '',
          currency: r.currency,
          amount,
          current_category: r.category,
          classification_status: r.classification_status,
          is_internal_transfer: Number(r.is_internal_transfer || 0) === 1,
          reconciliation_status: r.reconciliation_status
        }
      };
    });

    const now = Date.now();
    const actions = {};
    let last30 = 0, integrityPresent = 0;
    const sessions = new Set();
    for (const e of events) {
      actions[e.action] = (actions[e.action] || 0) + 1;
      if (new Date(e.created_at).getTime() >= now - 30 * 86400000) last30 += 1;
      if (e.integrity.present) integrityPresent += 1;
      if (e.session_id) sessions.add(e.session_id);
    }

    return res.json({
      privacy: 'Owner-only PERSONAL bank-transaction change history. Voxel Veda company finance events are excluded at query level.',
      read_only: true,
      integrity_note: 'This filtered view shows whether each returned audit row has an integrity hash. Because the global audit chain also contains events outside this PERSONAL subset, this page does not claim to independently re-verify full-chain continuity.',
      step_up_note: 'Only actions known to use a step-up-protected route are labelled as requiring step-up. Other rows are shown as not universally recorded rather than inferred.',
      summary: {
        events: events.length,
        last_30_days: last30,
        integrity_hash_present: integrityPresent,
        sessions_represented: sessions.size,
        action_counts: actions
      },
      events
    });
  } catch (error) { return fail(res, error); }
};
