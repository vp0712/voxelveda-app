const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);

assert(!tracked.some((file) => file === '.env' || /(^|\/)\.env\./.test(file) && !file.endsWith('.env.example')), 'runtime environment files must not be tracked');
assert(!tracked.some((file) => file.startsWith('node_modules/')), 'node_modules must not be tracked; the lockfile is authoritative');
assert(!tracked.some((file) => file.startsWith('uploads/') && !file.endsWith('.gitkeep')), 'runtime uploads must not be tracked');

const sourceFiles = tracked.filter((file) => /\.(js|json|yml|yaml|md|html)$/.test(file) && !file.startsWith('public/forms/'));
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const highConfidenceTokens = /(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_\-]{16,}/;
for (const file of sourceFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!privateKey.test(content), `private key material detected in ${file}`);
  assert(!highConfidenceTokens.test(content), `credential-like token detected in ${file}`);
}

const uiSmoke = fs.readFileSync(path.join(root, 'scripts/finance-ui-smoke.js'), 'utf8');
assert(!/UI_ADMIN_PASSWORD\s*\|\|\s*['"][^'"]+/.test(uiSmoke), 'UI smoke tests must not contain a default password');

console.log('Security source and secret-boundary tests passed.');
