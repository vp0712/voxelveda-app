'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const inventoryPath = path.join(root, 'docs', 'ENTERPRISE_ARCHITECTURE_INVENTORY.json');
const auditPath = path.join(root, 'docs', 'ENTERPRISE_DEEP_AUDIT.md');

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
let audit = fs.readFileSync(auditPath, 'utf8');

function replaceLine(label, value) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^- ' + escaped + ': .*$', 'm');
  const line = '- ' + label + ': ' + value;
  if (!pattern.test(audit)) throw new Error('Audit baseline line not found: ' + label);
  audit = audit.replace(pattern, line);
}

replaceLine('Latest fetched \`origin/main\` at audit start', '\`' + inventory.source_sha + '\`');
replaceLine('Audited source SHA', '\`' + inventory.source_sha + '\`');
replaceLine('Audited source commit time', '\`' + inventory.generated_at + '\`');
replaceLine('Inventory generated at', '\`' + inventory.generated_at + '\` (deterministic source commit time)');
replaceLine('Inventory generator version', '\`' + inventory.generator_version + '\`');
replaceLine('Current remediation branch', '\`main\`');

const totals = inventory.totals || {};
const stats = 'The deterministic inventory currently records '
  + Number(totals.text_source_files || 0).toLocaleString('en-AU') + ' text/source files, '
  + Number(totals.text_lines || 0).toLocaleString('en-AU') + ' lines, '
  + Number(totals.routes || 0).toLocaleString('en-AU') + ' declared HTTP routes, '
  + Number(totals.migrations || 0).toLocaleString('en-AU') + ' SQL migrations, '
  + Number(totals.worker_timer_sites || 0).toLocaleString('en-AU') + ' worker timer sites, and '
  + Number(totals.binary_assets || 0).toLocaleString('en-AU') + ' binary assets. Static matches are triage inputs, not proof by themselves:';

audit = audit.replace(
  /The deterministic inventory currently records .*? Static matches are triage inputs, not proof by themselves:/s,
  stats
);

audit = audit.replace(
  /This refreshed architecture inventory represents merged main at \`[a-f0-9]{40}\`\./,
  'This refreshed architecture inventory represents merged main at \`' + inventory.source_sha + '\`.'
);

const marker = '## Automated baseline refresh';
const section = marker + '\n\n'
  + 'This baseline is refreshed automatically from merged \`main\` by \`.github/workflows/enterprise-audit-refresh.yml\`. '
  + 'The workflow regenerates the machine-readable inventory from the exact source commit, updates this baseline metadata, '
  + 'verifies provenance, and publishes generated audit evidence as a workflow artifact. Narrative historical findings remain '
  + 'historical evidence; current production/provider status is maintained separately in \`docs/PRODUCTION_ASSURANCE_STATUS.md\`.\n';

if (audit.includes(marker)) {
  audit = audit.replace(/## Automated baseline refresh[\s\S]*?(?=\n## )/, section.trimEnd());
} else {
  const assuranceMatch = /\n##\s+Assurance state\s*\n/i.exec(audit);
  if (!assuranceMatch) throw new Error('Assurance state heading not found');
  const assurance = assuranceMatch.index;\n  audit = audit.slice(0, assurance) + '\n\n' + section.trimEnd() + '\n' + audit.slice(assurance);
}

fs.writeFileSync(auditPath, audit);
console.log('Enterprise audit baseline updated to ' + inventory.source_sha + '.');
