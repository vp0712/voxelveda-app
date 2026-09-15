const pool = require('../config/db');
const { detailedReadiness } = require('../services/runtimeState');

const PROVIDER_LABELS = Object.freeze({
  ADATREE: 'Adatree',
  BASIQ: 'Basiq',
  FROLLO: 'Frollo'
});

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function stateRank(state) {
  if (state === 'EXTERNALLY_VERIFIED' || state === 'OPERATIONAL') return 'READY';
  if (state === 'CONFIGURED' || state === 'INITIALIZING') return 'PARTIAL';
  if (state === 'FAILED') return 'BLOCKED';
  return 'NEEDS_SETUP';
}

function control(key, label, description, runtimeControls, { requiredForBankFeed = false, singleReplicaAcceptable = false } = {}) {
  const source = runtimeControls?.[key] || {};
  let status = stateRank(source.state);
  let plain = source.detail || 'Not checked yet.';

  if (key === 'redis_limiter' && singleReplicaAcceptable && status === 'NEEDS_SETUP') {
    status = 'PARTIAL';
    plain = 'The current one-server deployment can use the in-memory limiter. Add Redis before scaling to multiple app replicas.';
  }

  return {
    key,
    label,
    status,
    runtime_state: source.state || 'NOT_CONFIGURED',
    checked_at: source.checked_at || null,
    description,
    detail: plain,
    required_for_bank_feed: requiredForBankFeed
  };
}

exports.getReadiness = async (req, res) => {
  try {
    const runtime = detailedReadiness();
    const providerKey = String(process.env.BANK_DATA_PROVIDER || '').trim().toUpperCase();
    const providerConfigured = Boolean(
      providerKey &&
      configured('BANK_DATA_CLIENT_ID') &&
      configured('BANK_DATA_CLIENT_SECRET') &&
      configured('BANK_DATA_REDIRECT_URI')
    );
    const providerRecognised = Boolean(PROVIDER_LABELS[providerKey]);

    const controls = [
      {
        key: 'manual_statement_import',
        label: 'Statement import',
        status: 'READY',
        runtime_state: 'OPERATIONAL',
        checked_at: new Date().toISOString(),
        description: 'Upload bank statements, review rows, remove duplicates and approve before committing.',
        detail: 'Ready now. This does not require a live bank connection.',
        required_for_bank_feed: false
      },
      control('database_tls', 'Database encryption', 'Encrypts traffic between the app and the finance database.', runtime.controls, { requiredForBankFeed: true }),
      control('database_least_privilege', 'Database least privilege', 'Ensures the app database identity has only the permissions it actually needs.', runtime.controls, { requiredForBankFeed: true }),
      control('backup_provider', 'Verified backups', 'Confirms finance data can be restored after an infrastructure failure.', runtime.controls, { requiredForBankFeed: true }),
      control('redis_limiter', 'Shared rate limiting', 'Protects banking and finance APIs consistently when the app scales.', runtime.controls, { requiredForBankFeed: true, singleReplicaAcceptable: true }),
      control('webhook_signing', 'Signed bank webhooks', 'Authenticates provider callbacks before the app accepts bank-feed events.', runtime.controls, { requiredForBankFeed: true }),
      control('canonical_domain', 'Canonical secure domain', 'Keeps consent redirects and callbacks pinned to the approved Voxel Veda app domain.', runtime.controls, { requiredForBankFeed: true })
    ];

    const [connectionRows] = await pool.query(
      `SELECT connection_uid, provider, institution, consent_status, consent_expires_at,
              last_sync_completed_at, last_sync_status, last_sync_error_code
       FROM bank_connections ORDER BY created_at DESC LIMIT 25`
    );

    const requiredControls = controls.filter((item) => item.required_for_bank_feed);
    const hardBlockers = requiredControls.filter((item) => item.status === 'BLOCKED' || item.status === 'NEEDS_SETUP');
    const partial = requiredControls.filter((item) => item.status === 'PARTIAL');

    let overall = 'MANUAL_READY';
    let headline = 'Statement imports are ready. Live bank feeds still need production setup.';
    if (providerConfigured && providerRecognised && hardBlockers.length === 0 && partial.length === 0) {
      overall = 'PROVIDER_CREDENTIALS_READY';
      headline = 'Infrastructure is ready for provider-adapter verification. Live consent still remains disabled until the adapter is verified.';
    } else if (providerConfigured) {
      overall = 'PROVIDER_PARTIAL';
      headline = 'Bank-provider credentials are present, but production controls are not fully ready.';
    }

    const nextActions = [];
    if (!providerConfigured) nextActions.push('Choose an Australian CDR/Open Banking provider and add its production credentials in Railway secrets.');
    if (!providerRecognised && providerKey) nextActions.push(`BANK_DATA_PROVIDER=${providerKey} is not in the approved provider registry yet.`);
    for (const item of hardBlockers) nextActions.push(`${item.label}: ${item.detail}`);
    for (const item of partial) nextActions.push(`${item.label}: ${item.detail}`);
    if (!configured('BANK_DATA_WEBHOOK_SECRET')) nextActions.push('Add a provider webhook secret/signing configuration before enabling automatic bank sync.');

    return res.json({
      overall,
      headline,
      manual_import_ready: true,
      open_banking: {
        enabled: false,
        provider_key: providerKey || null,
        provider_name: PROVIDER_LABELS[providerKey] || null,
        credentials_present: providerConfigured,
        provider_recognised: providerRecognised,
        redirect_uri_present: configured('BANK_DATA_REDIRECT_URI'),
        webhook_secret_present: configured('BANK_DATA_WEBHOOK_SECRET'),
        explanation: 'Open Banking remains fail-closed until a production provider adapter, consent callback and signed webhook verification have been tested.'
      },
      controls,
      connections: connectionRows,
      next_actions: nextActions,
      safety_rules: [
        'Voxel Veda must never ask for or store internet-banking passwords, PINs or bank OTPs.',
        'Bank consent must happen on the bank/provider-controlled CDR flow.',
        'Imported or synced transactions must still pass duplicate, ownership and reconciliation controls.',
        'Personal and business data should remain separately scoped for access and reporting.'
      ]
    });
  } catch (error) {
    console.error('Failed to load finance banking readiness:', error);
    return res.status(500).json({ message: 'Failed to load banking readiness.', code: 'BANKING_READINESS_ERROR' });
  }
};
