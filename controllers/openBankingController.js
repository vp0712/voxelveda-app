const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const {
  basiqCreateUser,
  createConsentSession,
  environment,
  liveSyncEnabled,
  providerOptions,
  selectedProvider,
  stateHash,
  stateToken
} = require('../services/openBankingProviderService');

function clean(value) { return String(value || '').trim(); }
function uid(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${require('node:crypto').randomBytes(4).toString('hex').toUpperCase()}`; }

function fail(res, error, fallback) {
  console.error(fallback, error);
  const known = new Set(['BASIQ_API_KEY_REQUIRED','PROVIDER_ADAPTER_NOT_READY','BASIQ_TOKEN_INVALID','BASIQ_CLIENT_TOKEN_INVALID','PROVIDER_USER_ID_MISSING']);
  const status = known.has(error?.code) ? 503 : (Number(error?.status) || 500);
  return res.status(status).json({ message: error?.message || fallback, code: error?.code || 'OPEN_BANKING_ERROR' });
}

exports.getProviders = async (req, res) => {
  return res.json({
    environment: environment(),
    selected_provider: selectedProvider() || null,
    live_sync_enabled: liveSyncEnabled(),
    providers: providerOptions(),
    recommendation: {
      provider: 'BASIQ',
      mode: 'SANDBOX_FIRST',
      reason: 'The first implemented adapter is Basiq sandbox so consent, account and webhook flows can be validated without enabling live bank sync.'
    }
  });
};

exports.getSessions = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT session_uid, provider, environment, status, provider_user_id, consent_url_created_at,
              expires_at, completed_at, cancelled_at, last_error_code, created_at
       FROM open_banking_consent_sessions
       WHERE app_user_id=? ORDER BY created_at DESC LIMIT 30`, [req.user.id]
    );
    return res.json({ sessions: rows });
  } catch (error) {
    return fail(res, error, 'Failed to load bank consent sessions.');
  }
};

exports.startConsent = async (req, res) => {
  let db;
  try {
    const provider = clean(req.body.provider || selectedProvider()).toUpperCase();
    const option = providerOptions().find((item) => item.key === provider);
    if (!option) return res.status(400).json({ message: 'Choose a supported Open Banking provider.', code: 'PROVIDER_NOT_SUPPORTED' });
    if (!option.configured) return res.status(503).json({ message: `${option.name} is not configured yet. Missing: ${option.missing.join(', ')}.`, code: 'PROVIDER_CREDENTIALS_MISSING', missing: option.missing });
    if (environment() === 'PRODUCTION' && !liveSyncEnabled()) return res.status(503).json({ message: 'Production bank consent is locked. Complete sandbox verification first, then explicitly enable live sync.', code: 'LIVE_BANKING_LOCKED' });

    const email = clean(req.user?.email);
    if (!email) return res.status(400).json({ message: 'Your app profile needs an email address before creating a bank-consent identity.', code: 'USER_EMAIL_REQUIRED' });

    db = await pool.getConnection();
    await db.beginTransaction();
    let [[mapping]] = await db.query(
      `SELECT * FROM open_banking_provider_users WHERE app_user_id=? AND provider=? AND environment=? FOR UPDATE`,
      [req.user.id, provider, environment()]
    );
    if (!mapping) {
      if (provider !== 'BASIQ') {
        const unavailable = new Error(`${option.name} adapter is registered but not implemented yet.`);
        unavailable.code = 'PROVIDER_ADAPTER_NOT_READY';
        throw unavailable;
      }
      const created = await basiqCreateUser({
        email,
        firstName: clean(req.user?.first_name || req.user?.firstName),
        lastName: clean(req.user?.last_name || req.user?.lastName),
        businessName: clean(req.body.business_name),
        businessIdNo: clean(req.body.business_id),
        businessIdNoType: clean(req.body.business_id_type).toUpperCase() || undefined
      });
      const providerUserId = clean(created.id);
      if (!providerUserId) throw Object.assign(new Error('Provider did not return a user ID.'), { code: 'PROVIDER_USER_ID_MISSING' });
      await db.query(
        `INSERT INTO open_banking_provider_users (app_user_id, provider, provider_user_id, environment) VALUES (?,?,?,?)`,
        [req.user.id, provider, providerUserId, environment()]
      );
      mapping = { provider_user_id: providerUserId };
    }

    const state = stateToken();
    const sessionUid = uid('CONSENT');
    const consent = await createConsentSession({ provider, providerUserId: mapping.provider_user_id });
    const expiresSeconds = Math.min(3600, Math.max(300, Number(consent.token_expires_in || 3600)));
    await db.query(
      `INSERT INTO open_banking_consent_sessions
       (session_uid, app_user_id, provider, environment, state_hash, provider_user_id, status, consent_url_created_at, expires_at)
       VALUES (?,?,?,?,?,?, 'AWAITING_USER', NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [sessionUid, req.user.id, provider, environment(), stateHash(state), mapping.provider_user_id, expiresSeconds]
    );
    await logAudit(db, {
      actorId: req.user.id, ipAddress: req.ip, userAgent: req.get('user-agent'),
      action: 'OPEN_BANKING_CONSENT_STARTED', module: 'finance_intelligence', recordType: 'open_banking_consent', recordId: sessionUid,
      newValue: { provider, environment: environment() }
    });
    await db.commit();
    return res.json({
      message: `${option.name} ${environment().toLowerCase()} consent is ready. Continue only on the provider/bank-controlled page.`,
      session_uid: sessionUid,
      provider,
      environment: environment(),
      consent_url: consent.consent_url,
      expires_in_seconds: expiresSeconds,
      safety: 'Voxel Veda never receives or stores your bank password, PIN or OTP.'
    });
  } catch (error) {
    if (db) await db.rollback().catch(() => {});
    return fail(res, error, 'Failed to start Open Banking consent.');
  } finally {
    db?.release?.();
  }
};

exports.cancelConsent = async (req, res) => {
  try {
    const sessionUid = clean(req.params.uid);
    const [result] = await pool.query(
      `UPDATE open_banking_consent_sessions SET status='CANCELLED', cancelled_at=NOW()
       WHERE session_uid=? AND app_user_id=? AND status IN ('CREATED','AWAITING_USER')`,
      [sessionUid, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Active consent session not found.', code: 'CONSENT_SESSION_NOT_FOUND' });
    return res.json({ message: 'Consent session cancelled in Voxel Veda. If consent was already granted at the bank/provider, revoke it there as well.' });
  } catch (error) {
    return fail(res, error, 'Failed to cancel bank consent session.');
  }
};
