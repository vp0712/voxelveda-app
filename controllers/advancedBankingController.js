const crypto = require('node:crypto');
const pool = require('../config/db');
const { adapter, environment, liveSyncEnabled, providerOptions, selectedProvider } = require('../services/openBankingProviderService');
const { syncUserBanking } = require('../services/advancedBankingSyncService');
const { logAudit } = require('../services/auditService');

function clean(v, n = 500) { return String(v ?? '').trim().slice(0, n); }
function uid(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function fail(res, error, fallback) {
  const code = clean(error?.code || 'ADVANCED_BANKING_ERROR', 100);
  const known503 = ['BASIQ_API_KEY_REQUIRED','PROVIDER_ADAPTER_NOT_READY','LIVE_BANKING_LOCKED','PROVIDER_CREDENTIALS_MISSING'];
  const status = Number(error?.status || error?.statusCode) || (known503.includes(code) ? 503 : 500);
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({ message: error?.message || fallback, code });
}
async function mappingForUser(userId, provider) {
  const [[row]] = await pool.query(`SELECT * FROM open_banking_provider_users WHERE app_user_id=? AND provider=? AND environment=? LIMIT 1`, [userId, provider, environment()]);
  return row || null;
}

exports.status = async (req, res) => {
  try {
    const selected = selectedProvider() || 'BASIQ';
    const option = providerOptions().find((p) => p.key === selected) || providerOptions()[0];
    const [[summary]] = await pool.query(`SELECT COUNT(*) connections, SUM(status='ACTIVE') active, SUM(status IN ('ACTION_REQUIRED','EXPIRED','ERROR')) attention, MAX(last_sync_completed_at) last_sync FROM bank_connections WHERE app_user_id=?`, [req.user.id]);
    const [[sync]] = await pool.query(`SELECT status,last_error_code,error_detail,completed_at FROM open_banking_sync_runs WHERE app_user_id=? ORDER BY id DESC LIMIT 1`, [req.user.id]);
    return res.json({ provider: selected, provider_name: option?.name || selected, configured: Boolean(option?.configured), missing: option?.missing || [], environment: environment(), live_sync_enabled: liveSyncEnabled(), connection_summary: { total: Number(summary?.connections || 0), active: Number(summary?.active || 0), attention: Number(summary?.attention || 0), last_sync: summary?.last_sync || null }, last_sync: sync || null, cdr_notice: 'Bank data access is customer-consented and provider-managed. Voxel Veda does not claim independent CDR accreditation through this screen.' });
  } catch (e) { return fail(res, e, 'Failed to load banking status.'); }
};

exports.connections = async (req, res) => {
  try {
    const [connections] = await pool.query(`SELECT id,connection_uid,provider,institution,consent_status,consent_expires_at,last_sync_completed_at,last_sync_status,last_sync_error_code,status,next_sync_at,archived_at,disconnected_at,created_at FROM bank_connections WHERE app_user_id=? ORDER BY created_at DESC`, [req.user.id]);
    const [accounts] = await pool.query(`SELECT bca.connection_id,bca.provider_account_id,bca.bank_account_id,bca.account_name,bca.account_type,bca.account_number_masked,bca.currency,bca.current_balance,bca.available_balance,bca.status,bca.last_seen_at,bc.connection_uid,ba.ownership_scope FROM bank_connection_accounts bca JOIN bank_connections bc ON bc.id=bca.connection_id LEFT JOIN bank_accounts ba ON ba.id=bca.bank_account_id WHERE bc.app_user_id=? ORDER BY bc.id DESC,bca.id`, [req.user.id]);
    return res.json({ connections: connections.map((connection) => ({ ...connection, accounts: accounts.filter((a) => Number(a.connection_id) === Number(connection.id)).map(({ connection_id, ...account }) => account) })) });
  } catch (e) { return fail(res, e, 'Failed to load bank connections.'); }
};

exports.consentCenter = async (req, res) => {
  try {
    const provider = selectedProvider() || 'BASIQ';
    const mapping = await mappingForUser(req.user.id, provider);
    let providerConsents = [];
    if (mapping && providerOptions().find((p) => p.key === provider)?.configured) {
      try { providerConsents = (await adapter(provider).listConsents(mapping.provider_user_id))?.data || []; }
      catch { providerConsents = [{ status: 'UNAVAILABLE', message: 'Provider consent status could not be refreshed right now.' }]; }
    }
    const [receipts] = await pool.query(`SELECT receipt_uid,connection_uid,provider,consent_status,scopes_json,purpose_text,consented_at,expires_at,withdrawn_at,created_at FROM bank_consent_receipts WHERE app_user_id=? ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
    return res.json({ provider, provider_consents: providerConsents, local_receipts: receipts, privacy: { bank_credentials_stored: false, provider_tokens_returned_to_browser: false, disconnect_preserves_financial_history: true } });
  } catch (e) { return fail(res, e, 'Failed to load bank consent center.'); }
};

exports.sync = async (req, res) => {
  try {
    const provider = selectedProvider() || 'BASIQ';
    const mapping = await mappingForUser(req.user.id, provider);
    if (!mapping) return res.status(409).json({ message: 'Connect and consent to your bank before syncing.', code: 'BANK_CONSENT_REQUIRED' });
    const result = await syncUserBanking({ appUserId: req.user.id, providerUserId: mapping.provider_user_id, trigger: clean(req.body?.trigger || 'MANUAL', 30).toUpperCase(), actor: req.user.id });
    return res.json({ message: `Bank sync completed. ${result.inserted} new transaction(s), ${result.updated} updated, ${result.duplicates} duplicate(s) safely skipped.`, ...result });
  } catch (e) { return fail(res, e, 'Bank sync failed.'); }
};

exports.syncJobs = async (req, res) => {
  try {
    const [runs] = await pool.query(`SELECT sync_uid,connection_uid,provider,trigger_type,status,accounts_seen,accounts_linked,transactions_seen,transactions_inserted,transactions_updated,duplicates_skipped,started_at,completed_at,error_code,error_detail,created_at FROM open_banking_sync_runs WHERE app_user_id=? ORDER BY id DESC LIMIT 50`, [req.user.id]);
    return res.json({ sync_jobs: runs });
  } catch (e) { return fail(res, e, 'Failed to load bank sync history.'); }
};

exports.transactions = async (req, res) => {
  try {
    const accountId = Number(req.params.id || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const [[account]] = await pool.query(`SELECT ba.id,ba.nickname,ba.ownership_scope,ba.currency FROM bank_accounts ba JOIN bank_connection_accounts bca ON bca.bank_account_id=ba.id JOIN bank_connections bc ON bc.id=bca.connection_id WHERE ba.id=? AND bc.app_user_id=? LIMIT 1`, [accountId, req.user.id]);
    if (!account) return res.status(404).json({ message: 'Connected bank account not found.', code: 'BANK_ACCOUNT_NOT_FOUND' });
    const [rows] = await pool.query(`SELECT id,transaction_date,transaction_timestamp,description,merchant_name,debit,credit,running_balance,currency,category,classification_status,is_internal_transfer,source_type,source_provider,provider_status,reconciliation_status FROM bank_transactions WHERE bank_account_id=? AND superseded_at IS NULL ORDER BY transaction_date DESC,id DESC LIMIT ?`, [accountId, limit]);
    return res.json({ account, transactions: rows });
  } catch (e) { return fail(res, e, 'Failed to load bank transactions.'); }
};

exports.dataQuality = async (req, res) => {
  try {
    const [[m]] = await pool.query(`SELECT COUNT(DISTINCT bt.id) total, SUM(bt.provider_transaction_id IS NULL AND bt.source_type='OPEN_BANKING') missing_provider_ids, SUM(bt.classification_status='UNCLASSIFIED') unclassified, SUM(bt.reconciliation_status='UNRECONCILED') unreconciled, SUM(bt.canonical_fingerprint IS NULL) missing_fingerprint FROM bank_transactions bt JOIN bank_connection_accounts bca ON bca.bank_account_id=bt.bank_account_id JOIN bank_connections bc ON bc.id=bca.connection_id WHERE bc.app_user_id=? AND bc.status<>'DISCONNECTED'`, [req.user.id]);
    const [[c]] = await pool.query(`SELECT SUM(status='ACTIVE') healthy,SUM(status IN ('ACTION_REQUIRED','EXPIRED','ERROR')) attention,SUM(last_sync_completed_at IS NULL) never_synced FROM bank_connections WHERE app_user_id=?`, [req.user.id]);
    const score = Math.max(0, 100 - Number(m?.unclassified || 0) * 0.1 - Number(m?.unreconciled || 0) * 0.05 - Number(c?.attention || 0) * 10);
    return res.json({ score: Math.round(score * 10) / 10, transactions: m || {}, connections: c || {}, guidance: Number(c?.attention || 0) ? 'One or more bank connections need attention.' : 'No connection-level issue is currently detected.' });
  } catch (e) { return fail(res, e, 'Failed to calculate bank data quality.'); }
};

exports.archive = async (req, res) => {
  try {
    const uidValue = clean(req.params.uid, 64);
    const [result] = await pool.query(`UPDATE bank_connections SET status='ARCHIVED',archived_at=NOW(),next_sync_at=NULL WHERE connection_uid=? AND app_user_id=? AND status<>'DISCONNECTED'`, [uidValue, req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Active bank connection not found.', code: 'BANK_CONNECTION_NOT_FOUND' });
    return res.json({ message: 'Bank connection archived. Existing transaction history is preserved.' });
  } catch (e) { return fail(res, e, 'Failed to archive bank connection.'); }
};

exports.disconnect = async (req, res) => {
  let db;
  try {
    const uidValue = clean(req.params.uid, 64);
    db = await pool.getConnection(); await db.beginTransaction();
    const [[connection]] = await db.query(`SELECT * FROM bank_connections WHERE connection_uid=? AND app_user_id=? FOR UPDATE`, [uidValue, req.user.id]);
    if (!connection) { await db.rollback(); return res.status(404).json({ message: 'Bank connection not found.', code: 'BANK_CONNECTION_NOT_FOUND' }); }
    if (connection.provider === 'BASIQ' && connection.provider_connection_id && !/^USER-/.test(connection.provider_connection_id) && providerOptions().find((p) => p.key === 'BASIQ')?.configured) await adapter('BASIQ').deleteConnection(connection.provider_connection_id);
    await db.query(`UPDATE bank_connections SET status='DISCONNECTED',consent_status='REVOKED',disconnected_at=NOW(),next_sync_at=NULL WHERE id=?`, [connection.id]);
    const receiptUid = uid('CONSENT');
    await db.query(`INSERT INTO bank_consent_receipts (receipt_uid,app_user_id,connection_uid,provider,provider_user_id,consent_status,withdrawn_at,purpose_text) VALUES (?,?,?,?,?,'WITHDRAWN',NOW(),'User disconnected bank access from Voxel Veda')`, [receiptUid, req.user.id, connection.connection_uid, connection.provider, connection.provider_user_id]);
    await logAudit(db, { actorId: req.user.id, ipAddress: req.ip, userAgent: req.get('user-agent'), action: 'BANK_CONNECTION_DISCONNECTED', module: 'finance_intelligence', recordType: 'bank_connection', recordId: connection.connection_uid, newValue: { provider: connection.provider } });
    await db.commit();
    return res.json({ message: 'Bank access disconnected. Stored financial history remains available unless separately deleted under your data policy.' });
  } catch (e) { if (db) await db.rollback().catch(() => {}); return fail(res, e, 'Failed to disconnect bank connection.'); }
  finally { db?.release?.(); }
};

exports.reauthorize = async (req, res) => res.status(409).json({ message: 'Start a new provider consent session to renew or expand bank-data consent.', code: 'START_NEW_CONSENT_REQUIRED', action: '/api/finance/intelligence/open-banking/consent' });
