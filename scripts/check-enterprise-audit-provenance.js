const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const inventoryPath = path.join(root, 'docs', 'ENTERPRISE_ARCHITECTURE_INVENTORY.json');
const auditPath = path.join(root, 'docs', 'ENTERPRISE_DEEP_AUDIT.md');
const shaPattern = /^[a-f0-9]{40}$/;

function fail(message) {
  console.error(`Audit provenance check failed: ${message}`);
  process.exit(1);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result.stdout.trim();
}

let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
} catch (error) {
  fail(`inventory is not valid JSON: ${error.message}`);
}

if (Number(inventory.schema_version) < 2) fail('schema_version must support explicit provenance');
if (!shaPattern.test(String(inventory.source_sha || ''))) fail('source_sha must be a full lowercase Git SHA');
if (inventory.baseline_sha !== inventory.source_sha) fail('baseline_sha must equal source_sha');
if (!String(inventory.generator_version || '').trim()) fail('generator_version is required');
if (!Number.isFinite(Date.parse(inventory.generated_at))) fail('generated_at must be a valid timestamp');

const sourceSha = inventory.source_sha;
git(['cat-file', '-e', `${sourceSha}^{commit}`]);
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, 'HEAD'], { cwd: root, encoding: 'utf8' });
if (ancestry.status !== 0) fail('source_sha must be an ancestor of the checked-out revision');

const sourceTimestamp = git(['show', '-s', '--format=%cI', sourceSha]);
if (new Date(sourceTimestamp).getTime() !== new Date(inventory.generated_at).getTime()) {
  fail('generated_at must equal the audited source commit timestamp for deterministic output');
}

const audit = fs.readFileSync(auditPath, 'utf8');
if (!audit.includes(`Audited source SHA: \`${sourceSha}\``)) fail('deep audit does not name the inventory source_sha');
if (!audit.includes(`Inventory generator version: \`${inventory.generator_version}\``)) fail('deep audit does not name the inventory generator version');

console.log(`Audit provenance verified for ${sourceSha} using generator ${inventory.generator_version}.`);
