const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((file) => /(^|\/)(?:\.env\.example|[^/]+\.(?:js|json|md|sql|yml|yaml|toml|properties|plist|xcconfig))$/i.test(file));
const findings = [];
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['stripe-live-key', /\bsk_live_[A-Za-z0-9]{20,}\b/g]
];
const assignment = /\b(JWT_SECRET|SESSION_SECRET|MFA_ENCRYPTION_KEY|FINANCE_ENCRYPTION_KEY|SHIFT_QR_SIGNING_KEY|SMTP_PASSWORD|DB_PASSWORD|DATABASE_URL|WEBHOOK_SIGNING_KEY)\s*=\s*([^\s#]*)/g;
const safeValue = /^(|replace-|changeme|example|placeholder|<|\$\{|process\.)/i;

for (const file of files) {
  const full = path.join(root, file);
  let content;
  try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
  for (const [name, pattern] of signatures) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) findings.push(`${file}:${content.slice(0, match.index).split('\n').length}:${name}`);
  }
  assignment.lastIndex = 0;
  for (const match of content.matchAll(assignment)) {
    const value = String(match[2] || '').replace(/^['"]|['"]$/g, '');
    if (value && !safeValue.test(value)) findings.push(`${file}:${content.slice(0, match.index).split('\n').length}:hardcoded-${match[1].toLowerCase()}`);
  }
}

if (findings.length) {
  console.error(`Secret scan failed:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan passed across ${files.length} repository text files.`);
