'use strict';

const crypto = require('crypto');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required`), { code: 'OBJECT_STORAGE_CONFIG_MISSING' });
  return value;
}

function configuration() {
  const provider = String(process.env.OBJECT_STORAGE_PROVIDER || '').trim().toLowerCase();
  if (provider !== 'railway_s3') {
    throw Object.assign(new Error('OBJECT_STORAGE_PROVIDER must be railway_s3'), { code: 'OBJECT_STORAGE_PROVIDER_UNSUPPORTED' });
  }
  return {
    provider,
    bucket: required('OBJECT_STORAGE_BUCKET'),
    region: required('OBJECT_STORAGE_REGION'),
    endpoint: required('OBJECT_STORAGE_ENDPOINT'),
    accessKeyId: required('OBJECT_STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: required('OBJECT_STORAGE_SECRET_ACCESS_KEY')
  };
}

function isConfigured() {
  try { configuration(); return true; } catch { return false; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function encodeKey(key) {
  return String(key || '').split('/').filter(Boolean).map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

function endpointFor(config, key) {
  const endpoint = new URL(config.endpoint);
  const encoded = encodeKey(key);
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${encoded}`;
  endpoint.search = '';
  return endpoint;
}

function signingHeaders(config, method, url, bodyBuffer) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(bodyBuffer || Buffer.alloc(0));
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(Buffer.from(`AWS4${config.secretAccessKey}`, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    Authorization: authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
}

async function requestObject(method, key, { body, contentType } = {}) {
  const config = configuration();
  const bodyBuffer = body == null ? Buffer.alloc(0) : (Buffer.isBuffer(body) ? body : Buffer.from(body));
  const url = endpointFor(config, key);
  const headers = signingHeaders(config, method, url, bodyBuffer);
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(url, {
    method,
    headers,
    body: ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : bodyBuffer,
    signal: AbortSignal.timeout(Math.max(1000, Number(process.env.OBJECT_STORAGE_TIMEOUT_MS || 15000)))
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    const error = new Error(`Object storage ${method} failed with HTTP ${response.status}`);
    error.code = 'OBJECT_STORAGE_REQUEST_FAILED';
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return response;
}

async function putObject(key, body, contentType = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await requestObject('PUT', key, { body: buffer, contentType });
  return { key, size: buffer.length };
}

async function getObject(key) {
  const response = await requestObject('GET', key);
  return Buffer.from(await response.arrayBuffer());
}

async function deleteObject(key) {
  await requestObject('DELETE', key);
  return { key, deleted: true };
}

function storageUri(key) {
  const { bucket } = configuration();
  return `s3://${bucket}/${encodeKey(key)}`;
}

function keyFromStorageUri(uri) {
  const value = String(uri || '');
  if (!value.startsWith('s3://')) return null;
  const slash = value.indexOf('/', 5);
  return slash >= 0 ? decodeURIComponent(value.slice(slash + 1)) : null;
}

async function healthProbe() {
  const marker = `voxelveda-object-storage-health:${crypto.randomUUID()}`;
  const key = `.health/${Date.now()}-${crypto.randomUUID()}.txt`;
  try {
    await putObject(key, marker, 'text/plain');
    const loaded = await getObject(key);
    if (loaded.toString('utf8') !== marker) {
      throw Object.assign(new Error('Object storage health probe content mismatch'), { code: 'OBJECT_STORAGE_PROBE_MISMATCH' });
    }
    return { ok: true, provider: configuration().provider };
  } finally {
    await deleteObject(key).catch(() => {});
  }
}

module.exports = {
  configuration,
  deleteObject,
  getObject,
  healthProbe,
  isConfigured,
  keyFromStorageUri,
  putObject,
  storageUri
};
