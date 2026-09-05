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
  if (production) {
    const mfaKey = String(process.env.MFA_ENCRYPTION_KEY || '').trim();
    let decodedLength = 0;
    try { decodedLength = /^[a-f0-9]{64}$/i.test(mfaKey) ? Buffer.from(mfaKey, 'hex').length : Buffer.from(mfaKey, 'base64').length; } catch { decodedLength = 0; }
    if (decodedLength !== 32) failures.push('MFA_ENCRYPTION_KEY must be a unique 32-byte hex or base64 secret');
    const financeKey = String(process.env.FINANCE_ENCRYPTION_KEY || '').trim();
    let financeKeyLength = 0;
    try { financeKeyLength = /^[a-f0-9]{64}$/i.test(financeKey) ? Buffer.from(financeKey, 'hex').length : Buffer.from(financeKey, 'base64').length; } catch { financeKeyLength = 0; }
    if (financeKeyLength !== 32) failures.push('FINANCE_ENCRYPTION_KEY must be a unique 32-byte hex or base64 secret');
  }
  if (failures.length) throw new Error(`Security configuration invalid: ${failures.join('; ')}`);
}

module.exports = { validateSecurityEnvironment };
