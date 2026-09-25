const pool = require('../config/db');
const { detailedReadiness } = require('../services/runtimeState');
const { environment, liveSyncEnabled, providerOptions, selectedProvider } = require('../services/openBankingProviderService');

const PROVIDER_LABELS = Object.freeze({
  ADATREE: 'Adatree',
  BASIQ: 'Basiq',
  FROLLO: 'Frollo'
});

const CONTROL_GUIDANCE = Object.freeze({
  database_tls: {
    category: 'Data protection', priority: 'CRITICAL', owner: 'Platform', action_type: 'ENGINEERING',
    plain_name: 'Encrypt the app-to-database connection',
    why_it_matters: 'Finance data should not travel between the app and MySQL over an unverified transport.',
    next_step: 'Install or trust the correct Railway MySQL CA chain, then require TLS with certificate verification and confirm the live SSL cipher.'
  },
  database_least_privilege: {
    category: 'Access control', priority: 'CRITICAL', owner: 'System', action_type: 'AUTOMATIC',
    plain_name: 'Use a restricted database account',
    why_it_matters: 'A compromised app process should not automatically have database-administrator privileges.',
    next_step: 'No action when Ready. The app re-checks the active MySQL identity and grants on startup.'
  },
  backup_provider: {
    category: 'Recovery', priority: 'CRITICAL', owner: 'Owner', action_type: 'OWNER_APPROVAL',
    plain_name: 'Protect the finance database with recoverable backups',
    why_it_matters: 'Without a recent recoverable snapshot, accidental deletion or database corruption can become permanent data loss.',
    next_step: 'Approve the staged Daily + Weekly MySQL volume backup schedules in Railway with 2FA, then wait for and verify the first real snapshot.'
  },
  redis_limiter: {
    category: 'Abuse protection', priority: 'HIGH', owner: 'System', action_type: 'AUTOMATIC',
    plain_name: 'Use one shared rate limiter for all app instances',
    why_it_matters: 'Banking and finance endpoints need consistent request limits even when the app scales to multiple replicas.',
    next_step: 'No action when Ready. Production is configured to fail closed if the Redis limiter is unavailable.'
  },
  webhook_signing: {
    category: 'Integration security', priority: 'CRITICAL', owner: 'System', action_type: 'AUTOMATIC',
    plain_name: 'Reject fake or replayed bank/provider callbacks',
    why_it_matters: 'Unsigned callbacks could allow an attacker to imitate an integration provider.',
    next_step: 'No action when Ready. Startup now self-tests HMAC verification, tamper rejection and the replay window.'
  },
  canonical_domain: {
    category: 'Domain trust', priority: 'HIGH', owner: 'Owner + Platform', action_type: 'OWNER_APPROVAL',
    plain_name: 'Pin banking redirects to the verified Voxel Veda app domain',
    why_it_matters: 'Consent redirects and security-sensitive links should use one verified HTTPS domain, not preview or development addresses.',
    next_step: 'Finish and independently verify DNS + TLS for app.voxelveda.com before enabling forced canonical-host redirects.'
  }
});

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function stateRank(state) {
  if (state === 'EXTERNALLY_VERIFIED' || state === 'OPERATIONAL') return 'READY';
  if (state === 'CONFIGURED' || state === 'INITIALIZING' || state === 'DEGRADED') return 'PARTIAL';
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

  const guidance = CONTROL_GUIDANCE[key] || {};
  return {
    key,
    label,
    plain_name: guidance.plain_name || label,
    status,
    runtime_state: source.state || 'NOT_CONFIGURED',
    checked_at: source.checked_at || null,
    description,
    detail: plain,
    category: guidance.category || 'Platform control',
    priority: guidance.priority || (requiredForBankFeed ? 'HIGH' : 'NORMAL'),
    owner: guidance.owner || 'System',
    action_type: guidance.action_type || 'AUTOMATIC',
    why_it_matters: guidance.why_it_matters || description,
    next_step: guidance.next_step || 'Follow the reported control detail.',
    user_action_required: guidance.action_type === 'OWNER_APPROVAL',
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
        plain_name: 'Import statements without connecting a bank',
        status: 'READY', runtime_state: 'OPERATIONAL', checked_at: new Date().toISOString(),
        description: 'Upload bank statements, review rows, remove duplicates and approve before committing.',
        detail: 'Ready now. This does not require a live bank connection.',
        category: 'Manual banking', priority: 'NORMAL', owner: 'User', action_type: 'AVAILABLE_NOW',
        why_it_matters: 'It gives you a safe way to analyse personal and company transactions while live Open Banking remains locked.',
        next_step: 'Upload a supported statement, review detected transactions, fix any classification issues and approve the import.',
        user_action_required: false, required_for_bank_feed: false
      },
      {
        key: 'open_banking_sandbox',
        label: 'Open Banking sandbox',
        plain_name: 'Test a bank connection without touching live finance data',
        status: sandboxConsentReady ? 'READY' : 'NEEDS_SETUP',
        runtime_state: sandboxConsentReady ? 'OPERATIONAL' : 'NOT_CONFIGURED',
        checked_at: new Date().toISOString(),
        description: 'Tests provider consent without enabling production bank syncing.',
        detail: sandboxConsentReady
          ? 'Basiq sandbox consent can be tested. Production sync remains locked.'
          : (providerKey ? `${PROVIDER_LABELS[providerKey] || providerKey} still needs ${provider?.missing?.join(', ') || 'adapter setup'} before sandbox consent can start.` : 'Select a provider. Basiq is the first sandbox-ready adapter.'),
        category: 'Provider testing', priority: 'HIGH', owner: 'Owner + Platform', action_type: 'SETUP',
        why_it_matters: 'A sandbox proves the consent, callback and sync flow before real bank data is allowed into the app.',
        next_step: sandboxConsentReady ? 'Run one complete sandbox consent and verify callback + sync evidence.' : 'Complete the selected provider sandbox credentials first.',
        user_action_required: !sandboxConsentReady, required_for_bank_feed: false
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
    const readyRequired = requiredControls.filter((item) => item.status === 'READY');
    const hardBlockers = requiredControls.filter((item) => item.status === 'BLOCKED' || item.status === 'NEEDS_SETUP');
    const partial = requiredControls.filter((item) => item.status === 'PARTIAL');
    const productionControlsReady = hardBlockers.length === 0 && partial.length === 0;
    const productionBankFeedReady = Boolean(providerConfigured && providerRecognised && productionControlsReady && bankEnvironment === 'PRODUCTION' && liveEnabled);

    // Public launch is deliberately separate from technical readiness. Environment flags here
    // record evidence references/approvals; they never create a licence or regulatory authority.
    const adiAuthorityReference = String(process.env.AU_ADI_AUTHORITY_REFERENCE || '').trim();
    const restrictedBankWordConsentReference = String(process.env.AU_RESTRICTED_BANK_WORD_CONSENT_REFERENCE || '').trim();
    const afsLicenceReference = String(process.env.AU_AFS_LICENCE_REFERENCE || '').trim();
    const amlCtfProgramApproved = String(process.env.AML_CTF_PROGRAM_APPROVED || '').toLowerCase() === 'true';
    const customerTermsApproved = String(process.env.PUBLIC_CUSTOMER_TERMS_APPROVED || '').toLowerCase() === 'true';
    const complaintsProcessApproved = String(process.env.PUBLIC_COMPLAINTS_PROCESS_APPROVED || '').toLowerCase() === 'true';
    const privacyReviewApproved = String(process.env.PUBLIC_PRIVACY_REVIEW_APPROVED || '').toLowerCase() === 'true';
    const publicPlatformLaunchApproved = String(process.env.PUBLIC_FINANCIAL_PLATFORM_LAUNCH_APPROVED || '').toLowerCase() === 'true';
    const publicBankBrandingReady = Boolean(adiAuthorityReference && restrictedBankWordConsentReference);
    const publicPlatformReady = Boolean(
      productionControlsReady &&
      customerTermsApproved &&
      complaintsProcessApproved &&
      privacyReviewApproved &&
      publicPlatformLaunchApproved
    );
    const publicLaunchBlockers = [
      !productionControlsReady ? 'Production security/recovery controls are not fully verified.' : null,
      !customerTermsApproved ? 'Public customer terms are not approved.' : null,
      !complaintsProcessApproved ? 'Public complaints/dispute process is not approved.' : null,
      !privacyReviewApproved ? 'Public privacy review is not approved.' : null,
      !publicPlatformLaunchApproved ? 'Public financial-platform launch approval is not recorded.' : null,
      !amlCtfProgramApproved ? 'AML/CTF program approval is not recorded for any designated service.' : null
    ].filter(Boolean);
    const weightedProgress = requiredControls.length
      ? Math.round(((readyRequired.length + (partial.length * 0.5)) / requiredControls.length) * 100)
      : 100;

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
    for (const item of [...hardBlockers, ...partial]) nextActions.push(`${item.plain_name}: ${item.next_step}`);
    if (!configured('BANK_DATA_WEBHOOK_SECRET')) nextActions.push('Configure provider-specific webhook verification before production bank syncing.');
    if (bankEnvironment === 'PRODUCTION' && !liveEnabled) nextActions.push('Production live sync remains locked until BANK_DATA_LIVE_SYNC_ENABLED=true is explicitly set after sandbox verification.');

    return res.json({
      overall,
      headline,
      manual_import_ready: true,
      progress: {
        production_controls_percent: weightedProgress,
        required_total: requiredControls.length,
        ready: readyRequired.length,
        partial: partial.length,
        blocked_or_missing: hardBlockers.length,
        owner_actions: requiredControls.filter((item) => item.user_action_required && item.status !== 'READY').length,
        explanation: `${readyRequired.length} of ${requiredControls.length} required production controls are fully ready.`
      },
      public_launch: {
        mode: publicBankBrandingReady ? 'BANK_BRANDING_EVIDENCE_PRESENT' : 'FINANCE_PLATFORM_ONLY',
        public_platform_ready: publicPlatformReady,
        bank_branding_ready: publicBankBrandingReady,
        bank_branding_allowed_by_app: publicBankBrandingReady,
        production_bank_feed_ready: productionBankFeedReady,
        evidence: {
          adi_authority_reference_present: Boolean(adiAuthorityReference),
          restricted_bank_word_consent_reference_present: Boolean(restrictedBankWordConsentReference),
          afs_licence_reference_present: Boolean(afsLicenceReference),
          aml_ctf_program_approved: amlCtfProgramApproved,
          customer_terms_approved: customerTermsApproved,
          complaints_process_approved: complaintsProcessApproved,
          privacy_review_approved: privacyReviewApproved,
          launch_approval_recorded: publicPlatformLaunchApproved
        },
        blockers: publicLaunchBlockers,
        wording_rule: publicBankBrandingReady
          ? 'Technical gate sees authority/consent references. Independent legal verification is still required before public bank claims.'
          : 'Use Voxel Veda Finance / financial platform wording. Do not present the service as a bank or copy another bank brand.'
      },
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
