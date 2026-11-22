'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isReviewedAiTeamReferenceExample } = require('./ai-team-reference-examples');
const { detectContentSecrets, scanContent, scanRepository } = require('./secret-scan');

const root = path.join(__dirname, '..');
const references = [
  ['.codex/agents/ecc-opensource-forker.toml', [[138, 'hardcoded-database_url'], [143, 'hardcoded-jwt_secret']]],
  ['.ai-team/ecc-reference/agents/opensource-forker.md', [[135, 'hardcoded-database_url'], [140, 'hardcoded-jwt_secret']]],
  ['.ai-team/ecc-reference/skills/deployment-patterns/SKILL.md', [[338, 'hardcoded-database_url']]],
  ['.ai-team/ecc-reference/skills/django-security/SKILL.md', [[581, 'hardcoded-database_url'], [587, 'hardcoded-database_url']]],
  ['.ai-team/ecc-reference/skills/docker-patterns/SKILL.md', [[27, 'hardcoded-database_url']]],
  ['.ai-team/ecc-reference/skills/flox-environments/SKILL.md', [[61, 'hardcoded-database_url'], [374, 'hardcoded-database_url']]],
  ['.ai-team/ecc-reference/skills/laravel-security/SKILL.md', [[837, 'hardcoded-db_password']]],
  ['.ai-team/ecc-reference/skills/prisma-patterns/SKILL.md', [[238, 'hardcoded-database_url'], [241, 'hardcoded-database_url']]]
];
const names = [
  ['JWT', 'SECRET'], ['SESSION', 'SECRET'], ['MFA', 'ENCRYPTION', 'KEY'], ['FINANCE', 'ENCRYPTION', 'KEY'],
  ['SHIFT', 'QR', 'SIGNING', 'KEY'], ['SMTP', 'PASSWORD'], ['DB', 'PASSWORD'], ['DATABASE', 'URL'], ['WEBHOOK', 'SIGNING', 'KEY']
].map(parts => parts.join('_'));
const value = 'synthetic-fixture-' + 'Z'.repeat(32);
const assignment = name => name + '=' + value + '\n';
const secretLine = assignment(names[0]);
const publicKinds = ['private-key', 'aws-access-key', 'github-token', 'slack-token', 'stripe-live-key'];
const signatures = [
  ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
  ['AK', 'IA'].join('') + 'A'.repeat(16),
  ['gh', 'p_'].join('') + 'B'.repeat(32),
  ['xo', 'xb-'].join('') + 'C'.repeat(24),
  ['sk_', 'live_'].join('') + 'D'.repeat(24)
];
const hash = source => createHash('sha256').update(source).digest('hex');
let examples = 0;
for (const [file, pairs] of references) {
  const source = fs.readFileSync(path.join(root, file));
  const before = hash(source);
  const detected = detectContentSecrets(source);
  assert.deepEqual(detected, pairs.map(([line, kind]) => ({ line, kind })), file + ': the unchanged scanner must identify the exact original public examples.');
  assert.deepEqual(scanContent(file, source), [], file + ': only the reviewed examples are exempt.');
  for (const [line, kind] of pairs) {
    examples++;
    assert.equal(isReviewedAiTeamReferenceExample(file, source, line, kind), true);
    for (const alternate of ['./' + file, '../' + file, '/' + file, file.replaceAll('/', '\\'), 'app.js', 'config/example.md']) {
      assert.equal(isReviewedAiTeamReferenceExample(alternate, source, line, kind), false, 'Path aliases and application files cannot inherit an exemption.');
    }
    assert.equal(isReviewedAiTeamReferenceExample(file, source, line + 1, kind), false);
    assert.equal(isReviewedAiTeamReferenceExample(file, source, String(line), kind), false);
    assert.equal(isReviewedAiTeamReferenceExample(file, source.toString('utf8'), line, kind), false, 'Validation must hash the original bytes, not normalized text.');
    assert.equal(isReviewedAiTeamReferenceExample(file, source, line, kind + '-other'), false);
    for (const signatureKind of publicKinds) assert.equal(isReviewedAiTeamReferenceExample(file, source, line, signatureKind), false);
  }
  assert.equal(scanContent('app.js', source).length, pairs.length, 'Identical bytes in application code still fail.');
  assert.equal(scanContent('.ai-team/unreviewed.md', source).length, pairs.length, 'There is no reference-directory exclusion.');
  const changed = Buffer.from(source); changed[0] ^= 1;
  assert.equal(scanContent(file, changed).length, pairs.length, 'Any byte edit invalidates every exemption.');
  assert.equal(scanContent(file, Buffer.concat([source, Buffer.from([0xff])])).length, pairs.length, 'Invalid UTF-8 changes are checked as raw bytes.');
  for (const altered of [Buffer.concat([source, Buffer.from('\n' + secretLine)]), Buffer.concat([Buffer.from(secretLine), source])]) {
    const findings = scanContent(file, altered);
    assert.equal(findings.length, pairs.length + 1, 'An appended or prepended credential is rejected along with the changed reference examples.');
    assert(findings.some(finding => finding.endsWith(':hardcoded-jwt_secret')));
    assert(!findings.join('\n').includes(value), 'Failure locations must not print sensitive values.');
  }
  const withSignatures = Buffer.concat([source, Buffer.from('\n' + signatures.join('\n'))]);
  const findings = scanContent(file, withSignatures);
  for (const kind of publicKinds) assert(findings.some(finding => finding.endsWith(':' + kind)), 'High-confidence credentials are never exempted: ' + kind);
  assert.equal(hash(fs.readFileSync(path.join(root, file))), before, 'Tests must preserve the installed upstream bytes.');
}
assert.equal(examples, 13, 'Exactly thirteen public-example findings were reviewed.');

for (const name of names) {
  const finding = scanContent('config/runtime.js', Buffer.from(assignment(name)));
  assert.deepEqual(finding, ['config/runtime.js:1:hardcoded-' + name.toLowerCase()], 'Every original protected assignment remains covered.');
  for (const safe of ['replace-me', 'changeme', 'example-token', 'placeholder-token', '<secret>', '${SECRET}', 'process.env.SECRET', 'crypto.randomBytes(32)']) {
    assert.deepEqual(scanContent('config/runtime.js', Buffer.from(name + '=' + safe + '\n')), [], 'Existing explicit placeholder semantics stay unchanged.');
  }
}
assert.throws(() => detectContentSecrets('text instead of bytes'), /original source bytes/);
assert.equal(isReviewedAiTeamReferenceExample('__proto__', Buffer.from(''), 1, 'hardcoded-jwt_secret'), false);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-ai-team-secret-scan-'));
try {
  for (const name of ['app.js', 'server.js']) fs.writeFileSync(path.join(fixture, name), '// clean packaged source\n');
  fs.writeFileSync(path.join(fixture, 'package.json'), '{}');
  const [reviewedFile] = references[0];
  const target = path.join(fixture, reviewedFile); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fs.readFileSync(path.join(root, reviewedFile)));
  assert.deepEqual(scanRepository(fixture).findings, [], 'The Git-less packaged-source path permits the same exact reviewed bytes.');
  fs.appendFileSync(target, '\n' + secretLine);
  assert.equal(scanRepository(fixture).findings.length, 3, 'Changed packaged references cannot hide a newly appended credential.');
  fs.unlinkSync(target);
  const newReference = path.join(fixture, '.ai-team/ecc-reference/new.md'); fs.mkdirSync(path.dirname(newReference), { recursive: true });
  fs.writeFileSync(newReference, secretLine);
  assert.equal(scanRepository(fixture).findings.length, 1, 'Untracked packaged reference files are scanned.');
  fs.unlinkSync(newReference);
  fs.writeFileSync(path.join(fixture, 'app.js'), secretLine);
  assert.equal(scanRepository(fixture).findings.length, 1, 'Application credentials remain rejected without Git metadata.');
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }

console.log('AI-team secret scanner tests passed: 13 exact public examples, byte/path/line/kind pins, changed/new/app credentials, all original assignment/signature checks, redaction and Git-less packaging.');
