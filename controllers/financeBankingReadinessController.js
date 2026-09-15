const pool = require('../config/db');
const { detailedReadiness } = require('../services/runtimeState');
const { environment, liveSyncEnabled, providerOptions, selectedProvider } = require('../services/openBankingProviderService');

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
    plain = 'The current one-server deployment can use the in-memory limiter. Add Redis before scaling to multiple app replicas or enabling production bank feeds.';
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
    const providerKey = selectedProvider();
    const providers = providerOptions();
    const provider = providers.find((item) => item.key === providerKey) || null;
    const providerConfigured = Boolean(provider?.configured);
    const providerRecognised = Boolean(provider);
    const bankEnvironment = environment();
    const liveEnabled = liveSyncEnabled();
    const sandboxConsentReady = Boolean(providerKey === 'BASIQ' && providerConfigured && bankEnvironment === 'SANDBOX');

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
      {
        key: 'open_banking_sandbox',
        label: 'Open Banking sandbox',
        status: sandboxConsentReady ? 'READY' : 'NEEDS_SETUP',
        runtime_state: sandboxConsentReady ? 'OPERATIONAL' : 'NOT_CONFIGURED',
        checked_at: new Date().toISOString(),
        description: 'Tests provider consent without enabling production bank syncing.',
        detail: sandboxConsentReady
          ? 'Basiq sandbox consent can be tested. Production sync remains locked.'
          : (providerKey ? `${PROVIDER_LABELS[providerKey] || providerKey} still needs ${provider?.missing?.join(', ') || 'adapter setup'} before sandbox consent can start.` : 'Select a provider. Basiq is the first sandbox-ready adapter.'),
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
    const productionControlsReady = hardBlockers.length === 0 && partial.length === 0;
    const productionBankFeedReady = Boolean(providerConfigured && providerRecognised && productionControlsReady && bankEnvironment === 'PRODUCTION' && liveEnabled);

    let overall = 'MANUAL_READY';
    let headline = 'Statement imports are ready. Open Banking can be prepared safely in sandbox mode.';
    if (sandboxConsentReady) {
      overall = 'SANDBOX_READY';
      headline = 'Basiq sandbox consent is ready to test. Production bank syncing is still locked.';
    }
    if (providerConfigured && bankEnvironment === 'PRODUCTION' && !productionBankFeedReady) {
      overall = 'PROVIDER_PARTIAL';
      headline = 'Provider credentials are present, but production bank syncing is still blocked by required controls or the live-sync lock.';
    }
    if (productionBankFeedReady) {
      overall = 'PRODUCTION_READY';
      headline = 'Production prerequisites are ready. Provider callback, webhook and transaction-sync verification must still pass before the first live consent.';
    }

    const nextActions = [];
    if (!providerKey) nextActions.push('Select an Australian Open Banking/CDR provider. Basiq is the first sandbox-ready adapter in Voxel Veda.');
    if (providerKey && !providerRecognised) nextActions.push(`BANK_DATA_PROVIDER=${providerKey} is not in the approved provider registry.`);
    if (providerRecognised && !providerConfigured) nextActions.push(`${provider.name}: add ${provider.missing.join(', ')} in Railway secrets.`);
    if (providerKey === 'BASIQ' && providerConfigured && bankEnvironment === 'SANDBOX') nextActions.push('Run a sandbox consent and verify the full user → consent → connection → webhook → sync flow before enabling production.');
    for (const item of hardBlockers) nextActions.push(`${item.label}: ${item.detail}`);
    for (const item of partial) nextActions.push(`${item.label}: ${item.detail}`);
    if (!configured('BANK_DATA_WEBHOOK_SECRET')) nextActions.push('Configure provider-specific webhook verification before production bank syncing.');
    if (bankEnvironment === 'PRODUCTION' && !liveEnabled) nextActions.push('Production live sync remains locked until BANK_DATA_LIVE_SYNC_ENABLED=true is explicitly set after sandbox verification.');

    return res.json({
      overall,
      headline,
      manual_import_ready: true,
      open_banking: {
        enabled: productionBankFeedReady,
        environment: bankEnvironment,
        sandbox_consent_ready: sandboxConsentReady,
        live_sync_enabled: liveEnabled,
        production_controls_ready: productionControlsReady,
        provider_key: providerKey || null,
        provider_name: provider?.name || null,
        credentials_present: providerConfigured,
        provider_recognised: providerRecognised,
        missing_credentials: provider?.missing || [],
        redirect_uri_present: configured('BANK_DATA_REDIRECT_URI'),
        webhook_secret_present: configured('BANK_DATA_WEBHOOK_SECRET'),
        explanation: productionBankFeedReady
          ? 'Production prerequisites are present, but the first live consent remains a controlled verification step.'
          : 'Open Banking remains fail-closed. Sandbox consent can be used independently when its provider credentials are configured.'
      },
      provider_options: providers.map((item) => ({ key: item.key, name: item.name, configured: item.configured, missing: item.missing, adapter_status: item.adapter_status })),
      controls,
      connections: connectionRows,
      next_actions: nextActions,
      safety_rules: [
        'Voxel Veda must never ask for or store internet-banking passwords, PINs or bank OTPs.',
        'Bank consent must happen on the bank/provider-controlled Open Banking flow.',
        'Sandbox consent and production bank feeds are separate. A sandbox test can never silently enable live syncing.',
        'Imported or synced transactions must still pass duplicate, ownership and reconciliation controls.',
        'Personal and business data should remain separately scoped for access and reporting.'
      ]
    });
  } catch (error) {
    console.error('Failed to load finance banking readiness:', error);
    return res.status(500).json({ message: 'Failed to load banking readiness.', code: 'BANKING_READINESS_ERROR' });
  }
};
