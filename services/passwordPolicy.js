const COMMON_PASSWORDS = new Set([
  'password', 'password123', 'admin123', '123456', '12345678', 'qwerty',
  'letmein', 'welcome', 'voxelveda'
]);

function validatePassword(password, context = {}) {
  const value = String(password || '');
  const minimum = Math.max(12, Number(process.env.PASSWORD_MIN_LENGTH || 14));
  const normalized = value.toLowerCase();
  const fragments = [context.email, context.username, context.name, 'voxel', 'veda']
    .filter(Boolean)
    .flatMap((item) => String(item).toLowerCase().split(/[^a-z0-9]+/))
    .filter((item) => item.length >= 4);
  const errors = [];

  if (value.length < minimum) errors.push(`Password must be at least ${minimum} characters`);
  if (COMMON_PASSWORDS.has(normalized)) errors.push('Password is too common');
  if (fragments.some((fragment) => normalized.includes(fragment))) {
    errors.push('Password must not contain your name, username, email, or company name');
  }
  if (/(.)\1{4,}/.test(value)) errors.push('Password contains too many repeated characters');
  if (/012345|123456|234567|345678|456789|abcdef|qwerty/i.test(value)) {
    errors.push('Password contains an easily guessed sequence');
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  if (value.length < 20 && classes < 3) errors.push('Use a longer passphrase or a mix of character types');

  return { valid: errors.length === 0, errors, minimum };
}

module.exports = { validatePassword };
