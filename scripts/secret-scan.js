const fs = require('fs');
const path = require('path');
const { listSourceFiles } = require('./source-file-inventory');
const { isReviewedAiTeamReferenceExample } = require('./ai-team-reference-examples');

const root = path.join(__dirname, '..');
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['stripe-live-key', /\bsk_live_[A-Za-z0-9]{20,}\b/g]
];
const assignment = /\b(JWT_SECRET|SESSION_SECRET|MFA_ENCRYPTION_KEY|FINANCE_ENCRYPTION_KEY|SHIFT_QR_SIGNING_KEY|SMTP_PASSWORD|DB_PASSWORD|DATABASE_URL|WEBHOOK_SIGNING_KEY)[ \t]*=[ \t]*([^\s#]*)/g;
const safeValue = /^(?:replace-|changeme$|example|placeholder|<|\$\{|process\.|crypto\.randomBytes\()/i;

function detectContentSecrets(source) {
  if (!Buffer.isBuffer(source)) throw new TypeError('Secret scanning requires the original source bytes.');
  const content = source.toString('utf8');
  const findings = [];
  for (const [name, pattern] of signatures) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) findings.push({ line: content.slice(0, match.index).split('\n').length, kind: name });
  }
  assignment.lastIndex = 0;
  for (const match of content.matchAll(assignment)) {
    const value = String(match[2] || '').replace(/^['"]|['"]$/g, '');
    if (value && !safeValue.test(value)) findings.push({ line: content.slice(0, match.index).split('\n').length, kind: `hardcoded-${match[1].toLowerCase()}` });
  }
  return findings;
}

function scanContent(file, source) {
  return detectContentSecrets(source)
    // High-confidence credential signatures are never eligible for exceptions.
    .filter(({ line, kind }) => !kind.startsWith('hardcoded-') || !isReviewedAiTeamReferenceExample(file, source, line, kind))
    .map(({ line, kind }) => `${file}:${line}:${kind}`);
}

function scanRepository(sourceRoot = root) {
  const files = listSourceFiles(sourceRoot)
    .filter((file) => /(^|\/)(?:\.env\.example|[^/]+\.(?:js|json|md|sql|yml|yaml|toml|properties|plist|xcconfig))$/i.test(file));
  const findings = [];
  for (const file of files) {
    let source;
    try { source = fs.readFileSync(path.join(sourceRoot, file)); } catch { continue; }
    findings.push(...scanContent(file, source));
  }
  return { files, findings };
}

if (require.main === module) {
  const { files, findings } = scanRepository();
  if (findings.length) {
    console.error(`Secret scan failed:\n${findings.join('\n')}`);
    process.exit(1);
  }
  console.log(`Secret scan passed across ${files.length} repository text files.`);
}

module.exports = { detectContentSecrets, scanContent, scanRepository };
