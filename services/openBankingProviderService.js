const crypto = require('node:crypto');

const PROVIDERS = Object.freeze({
  BASIQ: {
    key: 'BASIQ',
    name: 'Basiq',
    sandbox: true,
    adapter_status: 'SANDBOX_READY',
    strengths: ['Open Banking sandbox', 'Consent UI', 'Transaction enrichment', 'Webhooks'],
    requirements: ['BANK_DATA_API_KEY'],
    api_url: 'https://au-api.basiq.io',
    consent_url: 'https://consent.basiq.io/home'
  },
  ADATREE: {
    key: 'ADATREE',
    name: 'Adatree',
    sandbox: true,
    adapter_status: 'PLANNED',
    strengths: ['Australian CDR specialist', 'Business-account CDR support', 'Banking and consent APIs'],
    requirements: ['BANK_DATA_CLIENT_ID', 'BANK_DATA_CLIENT_SECRET'],
    api_url: null,
    consent_url: null
  },
  FROLLO: {
    key: 'FROLLO',
    name: 'Frollo',
    sandbox: false,
    adapter_status: 'PLANNED',
    strengths: ['Australian Open Banking', 'Financial data and lending workflows'],
    requirements: ['BANK_DATA_CLIENT_ID', 'BANK_DATA_CLIENT_SECRET'],
    api_url: null,
    consent_url: null
  }
});

function clean(value) {
  return String(value || '').trim();
}

function selectedProvider(env = process.env) {
  return clean(env.BANK_DATA_PROVIDER).toUpperCase();
}

function environment(env = process.env) {
  return clean(env.BANK_DATA_ENVIRONMENT || 'sandbox').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

function liveSyncEnabled(env = process.env) {
  return String(env.BANK_DATA_LIVE_SYNC_ENABLED || '').toLowerCase() === 'true';
}

function providerOptions(env = process.env) {
  const selected = selectedProvider(env);
  return Object.values(PROVIDERS).map((provider) => ({
    ...provider,
    selected: selected === provider.key,
    configured: provider.requirements.every((name) => Boolean(clean(env[name]))),
    missing: provider.requirements.filter((name) => !clean(env[name]))
  }));
}

async function basiqRequest(path, { method = 'GET', token, apiKey, body, form } = {}) {
  const base = clean(process.env.BANK_DATA_API_URL) || PROVIDERS.BASIQ.api_url;
  const headers = { Accept: 'application/json', 'basiq-version': '3.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers.Authorization = `Basic ${apiKey}`;
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(15000) });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || `Basiq request failed (${response.status})`);
    error.code = `BASIQ_HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function basiqServerToken() {
  const apiKey = clean(process.env.BANK_DATA_API_KEY);
  if (!apiKey) {
    const error = new Error('Basiq API key is not configured.');
    error.code = 'BASIQ_API_KEY_REQUIRED';
    throw error;
  }
  return basiqRequest('/token', { method: 'POST', apiKey, form: { scope: 'SERVER_ACCESS' } });
}

async function basiqClientToken(providerUserId) {
  const apiKey = clean(process.env.BANK_DATA_API_KEY);
  if (!apiKey) {
    const error = new Error('Basiq API key is not configured.');
    error.code = 'BASIQ_API_KEY_REQUIRED';
    throw error;
  }
  return basiqRequest('/token', { method: 'POST', apiKey, form: { scope: 'CLIENT_ACCESS', userId: providerUserId } });
}

async function basiqCreateUser({ email, firstName, lastName, businessName, businessIdNo, businessIdNoType }) {
  const auth = await basiqServerToken();
  const token = auth.access_token || auth.accessToken;
  if (!token) {
    const error = new Error('Basiq did not return a server access token.');
    error.code = 'BASIQ_TOKEN_INVALID';
    throw error;
  }
  const body = { email };
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (businessName) body.businessName = businessName;
  if (businessIdNo) body.businessIdNo = businessIdNo;
  if (businessIdNoType) body.businessIdNoType = businessIdNoType;
  return basiqRequest('/users', { method: 'POST', token, body });
}

async function createConsentSession({ provider, providerUserId }) {
  const key = String(provider || '').toUpperCase();
  if (key !== 'BASIQ') {
    const error = new Error(`${key || 'Selected'} provider adapter is not sandbox-ready yet.`);
    error.code = 'PROVIDER_ADAPTER_NOT_READY';
    throw error;
  }
  const auth = await basiqClientToken(providerUserId);
  const token = auth.access_token || auth.accessToken;
  if (!token) {
    const error = new Error('Basiq did not return a client consent token.');
    error.code = 'BASIQ_CLIENT_TOKEN_INVALID';
    throw error;
  }
  const consentBase = clean(process.env.BANK_DATA_CONSENT_URL) || PROVIDERS.BASIQ.consent_url;
  return {
    provider: 'BASIQ',
    consent_url: `${consentBase}?token=${encodeURIComponent(token)}`,
    token_expires_in: Number(auth.expires_in || auth.expiresIn || 3600)
  };
}

function stateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function stateHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = {
  PROVIDERS,
  basiqCreateUser,
  createConsentSession,
  environment,
  liveSyncEnabled,
  providerOptions,
  selectedProvider,
  stateHash,
  stateToken
};
