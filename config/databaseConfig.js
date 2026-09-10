const fs = require('node:fs');

function flag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function positiveInteger(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseDatabaseUrl(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!['mysql:', 'mysqls:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the mysql:// or mysqls:// scheme');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error('DATABASE_URL must include host, username and database name');
  }
  return {
    host: parsed.hostname,
    port: positiveInteger(parsed.port, 3306, 1, 65535),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    tlsFromUrl: parsed.protocol === 'mysqls:' || ['true', 'required', 'verify_ca', 'verify_identity']
      .includes(String(parsed.searchParams.get('ssl') || parsed.searchParams.get('ssl-mode') || '').toLowerCase())
  };
}

function readTlsCa(env) {
  const encoded = String(env.DB_TLS_CA_BASE64 || '').trim();
  if (encoded) return Buffer.from(encoded, 'base64').toString('utf8');
  const filename = String(env.DB_TLS_CA_FILE || '').trim();
  if (filename) return fs.readFileSync(filename, 'utf8');
  return undefined;
}

function buildDatabaseConfig(env = process.env) {
  const fromUrl = parseDatabaseUrl(env.DATABASE_URL);
  const source = fromUrl ? 'DATABASE_URL' : 'DISCRETE';
  const base = fromUrl || {
    host: String(env.DB_HOST || '127.0.0.1').trim(),
    port: positiveInteger(env.DB_PORT, 3307, 1, 65535),
    user: String(env.DB_USER || 'root').trim(),
    password: String(env.DB_PASSWORD || ''),
    database: String(env.DB_NAME || 'voxelveda').trim(),
    tlsFromUrl: false
  };
  if (!base.host || !base.user || !base.database) {
    throw new Error('Database host, username and database name are required');
  }

  const tlsRequested = flag(env.DB_TLS_REQUIRED) || base.tlsFromUrl;
  const tlsCa = readTlsCa(env);
  const rejectUnauthorized = env.DB_TLS_REJECT_UNAUTHORIZED === undefined
    ? true
    : flag(env.DB_TLS_REJECT_UNAUTHORIZED, true);
  const ssl = tlsRequested ? {
    minVersion: 'TLSv1.2',
    rejectUnauthorized,
    ...(tlsCa ? { ca: tlsCa } : {})
  } : undefined;

  return {
    options: {
      host: base.host,
      port: base.port,
      user: base.user,
      password: base.password,
      database: base.database,
      waitForConnections: true,
      connectionLimit: positiveInteger(env.DB_CONNECTION_LIMIT, 10, 1, 100),
      queueLimit: positiveInteger(env.DB_QUEUE_LIMIT, 0, 0, 100000),
      connectTimeout: positiveInteger(env.DB_CONNECT_TIMEOUT_MS, 10000, 1000, 120000),
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: 'utf8mb4',
      ...(ssl ? { ssl } : {})
    },
    summary: {
      source,
      configured: Boolean(base.host && base.user && base.database),
      tls_requested: tlsRequested,
      tls_certificate_verification: Boolean(ssl?.rejectUnauthorized),
      connection_limit: positiveInteger(env.DB_CONNECTION_LIMIT, 10, 1, 100)
    }
  };
}

module.exports = { buildDatabaseConfig, flag, parseDatabaseUrl, positiveInteger };
