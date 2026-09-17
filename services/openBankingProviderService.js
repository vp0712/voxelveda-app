const crypto = require('node:crypto');

const PROVIDERS = Object.freeze({
  BASIQ: {
    key: 'BASIQ',
    name: 'Basiq',
    sandbox: true,
    adapter_status: 'READY',
    strengths: ['Australian Open Banking', 'Hosted Consent UI', 'Accounts', 'Transactions', 'Connections', 'Webhooks'],
    requirements: ['BANK_DATA_API_KEY'],
    api_url: 'https://au-api.basiq.io',
    consent_url: 'https://consent.basiq.io/home'
  },
  ADATREE: {
    key: 'ADATREE', name: 'Adatree', sandbox: true, adapter_status: 'PLANNED',
    strengths: ['Australian CDR specialist'], requirements: ['BANK_DATA_CLIENT_ID', 'BANK_DATA_CLIENT_SECRET'], api_url: null, consent_url: null
  },
  FROLLO: {
    key: 'FROLLO', name: 'Frollo', sandbox: false, adapter_status: 'PLANNED',
    strengths: ['Australian Open Banking'], requirements: ['BANK_DATA_CLIENT_ID', 'BANK_DATA_CLIENT_SECRET'], api_url: null, consent_url: null
  }
});

function clean(value) { return String(value || '').trim(); }
function selectedProvider(env = process.env) { return clean(env.BANK_DATA_PROVIDER || env.BANKING_PROVIDER).toUpperCase(); }
function environment(env = process.env) { return clean(env.BANK_DATA_ENVIRONMENT || 'sandbox').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'; }
function liveSyncEnabled(env = process.env) { return String(env.BANK_DATA_LIVE_SYNC_ENABLED || env.BANK_SYNC_ENABLED || '').toLowerCase() === 'true'; }
function scheduledSyncEnabled(env = process.env) { return String(env.BANK_SYNC_SCHEDULE_ENABLED || '').toLowerCase() === 'true'; }
function providerOptions(env = process.env) {
  const selected = selectedProvider(env);
  return Object.values(PROVIDERS).map((provider) => ({ ...provider, selected: selected === provider.key, configured: provider.requirements.every((name) => Boolean(clean(env[name] || (name === 'BANK_DATA_API_KEY' ? env.BASIQ_API_KEY : '')))), missing: provider.requirements.filter((name) => !clean(env[name] || (name === 'BANK_DATA_API_KEY' ? env.BASIQ_API_KEY : ''))) }));
}

async function basiqRequest(path, { method = 'GET', token, apiKey, body, form, timeoutMs = 20000 } = {}) {
  const base = clean(process.env.BANK_DATA_API_URL || process.env.BASIQ_API_BASE) || PROVIDERS.BASIQ.api_url;
  const headers = { Accept: 'application/json', 'basiq-version': clean(process.env.BASIQ_API_VERSION) || '3.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers.Authorization = `Basic ${apiKey}`;
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || data?.data?.message || `Basiq request failed (${response.status})`);
    error.code = `BASIQ_HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return data;
}

function apiKey() { return clean(process.env.BANK_DATA_API_KEY || process.env.BASIQ_API_KEY); }
async function basiqServerToken() {
  const key = apiKey();
  if (!key) throw Object.assign(new Error('Basiq API key is not configured.'), { code: 'BASIQ_API_KEY_REQUIRED' });
  return basiqRequest('/token', { method: 'POST', apiKey: key, form: { scope: 'SERVER_ACCESS' } });
}
async function basiqClientToken(providerUserId) {
  const key = apiKey();
  if (!key) throw Object.assign(new Error('Basiq API key is not configured.'), { code: 'BASIQ_API_KEY_REQUIRED' });
  return basiqRequest('/token', { method: 'POST', apiKey: key, form: { scope: 'CLIENT_ACCESS', userId: providerUserId } });
}
async function serverBearer() {
  const auth = await basiqServerToken();
  const token = auth.access_token || auth.accessToken;
  if (!token) throw Object.assign(new Error('Basiq did not return a server access token.'), { code: 'BASIQ_TOKEN_INVALID' });
  return token;
}
async function basiqCreateUser({ email, firstName, lastName, businessName, businessIdNo, businessIdNoType, mobile }) {
  const token = await serverBearer();
  const body = { email };
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (mobile) body.mobile = mobile;
  if (businessName) body.businessName = businessName;
  if (businessIdNo) body.businessIdNo = businessIdNo;
  if (businessIdNoType) body.businessIdNoType = businessIdNoType;
  return basiqRequest('/users', { method: 'POST', token, body });
}
async function createConsentSession({ provider, providerUserId, state }) {
  const key = String(provider || '').toUpperCase();
  if (key !== 'BASIQ') throw Object.assign(new Error(`${key || 'Selected'} provider adapter is not ready.`), { code: 'PROVIDER_ADAPTER_NOT_READY' });
  const auth = await basiqClientToken(providerUserId);
  const token = auth.access_token || auth.accessToken;
  if (!token) throw Object.assign(new Error('Basiq did not return a client consent token.'), { code: 'BASIQ_CLIENT_TOKEN_INVALID' });
  const consentBase = clean(process.env.BANK_DATA_CONSENT_URL) || PROVIDERS.BASIQ.consent_url;
  const params = new URLSearchParams({ token });
  if (state) params.set('state', state);
  return { provider: 'BASIQ', consent_url: `${consentBase}?${params.toString()}`, token_expires_in: Number(auth.expires_in || auth.expiresIn || 3600) };
}
async function basiqGetUser(providerUserId) { return basiqRequest(`/users/${encodeURIComponent(providerUserId)}`, { token: await serverBearer() }); }
async function basiqListConnections(providerUserId) { return basiqRequest(`/users/${encodeURIComponent(providerUserId)}/connections`, { token: await serverBearer() }); }
async function basiqListAccounts(providerUserId) { return basiqRequest(`/users/${encodeURIComponent(providerUserId)}/accounts`, { token: await serverBearer() }); }
async function basiqListTransactions(providerUserId, { limit = 500, filter } = {}) {
  const query = new URLSearchParams({ limit: String(Math.min(500, Math.max(1, Number(limit) || 500))) });
  if (filter) query.set('filter', filter);
  return basiqRequest(`/users/${encodeURIComponent(providerUserId)}/transactions?${query.toString()}`, { token: await serverBearer(), timeoutMs: 30000 });
}
async function basiqGetConsents(providerUserId) { return basiqRequest(`/users/${encodeURIComponent(providerUserId)}/consents`, { token: await serverBearer() }); }
async function basiqRefreshConnection(connectionId) { return basiqRequest(`/connections/${encodeURIComponent(connectionId)}/refresh`, { method: 'POST', token: await serverBearer(), body: {} }); }
async function basiqDeleteConnection(connectionId) { return basiqRequest(`/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE', token: await serverBearer() }); }
async function basiqGetJob(jobId) { return basiqRequest(`/jobs/${encodeURIComponent(jobId)}`, { token: await serverBearer() }); }

function adapter(provider = selectedProvider()) {
  const key = String(provider || '').toUpperCase();
  if (key !== 'BASIQ') throw Object.assign(new Error(`${key || 'Selected'} provider adapter is not implemented.`), { code: 'PROVIDER_ADAPTER_NOT_READY' });
  return {
    provider: 'BASIQ',
    createUser: basiqCreateUser,
    createConsentSession: (args) => createConsentSession({ ...args, provider: 'BASIQ' }),
    getUser: basiqGetUser,
    listConnections: basiqListConnections,
    listAccounts: basiqListAccounts,
    listTransactions: basiqListTransactions,
    listConsents: basiqGetConsents,
    refreshConnection: basiqRefreshConnection,
    deleteConnection: basiqDeleteConnection,
    getJob: basiqGetJob
  };
}
function stateToken() { return crypto.randomBytes(32).toString('hex'); }
function stateHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

module.exports = {
  PROVIDERS, adapter, basiqCreateUser, basiqDeleteConnection, basiqGetConsents, basiqGetJob, basiqListAccounts,
  basiqListConnections, basiqListTransactions, basiqRefreshConnection, createConsentSession, environment, liveSyncEnabled,
  scheduledSyncEnabled, providerOptions, selectedProvider, stateHash, stateToken
};
