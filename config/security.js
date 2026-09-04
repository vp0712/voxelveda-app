const WEAK_SECRETS = new Set([
  'secret', 'changeme', 'password', 'jwt_secret', '123456',
  'replace-with-a-long-random-secret'
]);

function validateSecurityEnvironment() {
  const production = process.env.NODE_ENV === 'production';
  const secret = String(process.env.JWT_SECRET || '');
  const failures = [];
  if (!secret || secret.length < 32 || WEAK_SECRETS.has(secret.toLowerCase())) failures.push('JWT_SECRET must be a unique value of at least 32 characters');
  if (production && process.env.ALLOW_LEGACY_QUERY_TOKENS === 'true') failures.push('query-string authentication tokens are forbidden in production');
  if (production && process.env.ENABLE_ADMIN_BOOTSTRAP === 'true') failures.push('admin bootstrap must be disabled after secure provisioning');
  if (production && String(process.env.CORS_ORIGINS || '').includes('*')) failures.push('wildcard CORS is forbidden in production');
  if (failures.length) throw new Error(`Security configuration invalid: ${failures.join('; ')}`);
}

module.exports = { validateSecurityEnvironment };
