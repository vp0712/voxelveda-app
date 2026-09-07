const WEAK_SECRETS = new Set(['secret', 'changeme', 'password', 'jwt_secret', '123456', 'replace-with-a-long-random-secret']);

function secretBytes(value) {
  const input = String(value || '').trim();
  if (!input) return 0;
  try {
    if (/^[a-f0-9]+$/i.test(input) && input.length % 2 === 0) return Buffer.from(input, 'hex').length;
    return Buffer.from(input, 'base64').length;
  } catch { return 0; }
}

function validHttpsUrl(value) {
  try { return new URL(String(value || '')).protocol === 'https:'; } catch { return false; }
}

function assessProductionReadiness(env = process.env) {
  const failures = [];
  const warnings = [];
  const production = env.NODE_ENV === 'production';
  const jwt = String(env.JWT_SECRET || '');
  const session = String(env.SESSION_SECRET || '');
  const mfa = String(env.MFA_ENCRYPTION_KEY || '').trim();
  const finance = String(env.FINANCE_ENCRYPTION_KEY || '').trim();
  const shiftQr = String(env.SHIFT_QR_SIGNING_KEY || '').trim();

  if (!jwt || jwt.length < 32 || WEAK_SECRETS.has(jwt.toLowerCase())) failures.push('JWT_SECRET must be a unique value of at least 32 characters');
  if (production && (!session || session.length < 32 || WEAK_SECRETS.has(session.toLowerCase()))) failures.push('SESSION_SECRET must be a unique value of at least 32 characters');
  if (production && jwt === session) failures.push('JWT_SECRET and SESSION_SECRET must be different');
  if (production && secretBytes(mfa) !== 32) failures.push('MFA_ENCRYPTION_KEY must be a unique 32-byte hex or base64 secret');
  if (production && secretBytes(finance) !== 32) failures.push('FINANCE_ENCRYPTION_KEY must be a unique 32-byte hex or base64 secret');
  if (production && secretBytes(shiftQr) < 32) failures.push('SHIFT_QR_SIGNING_KEY must be at least 32 random bytes encoded as hex or base64');
  if (production && [jwt, session, mfa, finance, shiftQr].filter(Boolean).length !== new Set([jwt, session, mfa, finance, shiftQr].filter(Boolean)).size) failures.push('Security secrets and encryption keys must not be reused');

  if (production && env.ALLOW_LEGACY_QUERY_TOKENS === 'true') failures.push('query-string authentication tokens are forbidden in production');
  if (production && env.ENABLE_ADMIN_BOOTSTRAP === 'true') failures.push('admin bootstrap must be disabled after secure provisioning');
  if (production && env.ALLOW_PUBLIC_ADMIN_REGISTRATION === 'true') failures.push('public administrator registration is forbidden');
  if (production && env.DEBUG_AUTH_BYPASS === 'true') failures.push('debug authentication bypass is forbidden');
  if (production && env.TRUST_PROXY !== 'true') failures.push('TRUST_PROXY must be true behind Railway');

  const origins = String(env.ALLOWED_ORIGINS || env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (production && !origins.length) failures.push('ALLOWED_ORIGINS must explicitly list trusted production origins');
  if (production && origins.some((origin) => origin === '*' || origin.includes('*'))) failures.push('wildcard CORS is forbidden in production');
  if (production && origins.some((origin) => !validHttpsUrl(origin))) failures.push('production CORS origins must use HTTPS');
  if (production && !validHttpsUrl(env.APP_URL || env.PUBLIC_APP_URL)) failures.push('APP_URL must be an HTTPS production URL');

  if (production && !env.MALWARE_SCANNER_PROVIDER) warnings.push('MALWARE_SCANNER_PROVIDER is not configured; uploads remain unavailable for automated malware scanning');
  if (production && env.BACKUP_STATUS_PROVIDER !== 'configured') warnings.push('Database backup status is not attested by a configured provider');
  if (production && env.RATE_LIMIT_STORE !== 'redis') warnings.push('Rate limiting is process-local; configure a shared Redis-backed limiter before scaling beyond one replica');
  if (production && env.FORCE_CANONICAL_HOST !== 'true') warnings.push('Canonical-host enforcement remains disabled until custom-domain DNS and TLS are verified');

  return { production, ready: failures.length === 0, failures, warnings };
}

function validateProductionReadiness(env = process.env) {
  const result = assessProductionReadiness(env);
  if (!result.ready) throw new Error(`Security configuration invalid: ${result.failures.join('; ')}`);
  return result;
}

module.exports = { assessProductionReadiness, secretBytes, validateProductionReadiness };
