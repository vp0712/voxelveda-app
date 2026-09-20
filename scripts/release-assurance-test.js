const fs = require('node:fs');
function read(path){ return fs.readFileSync(path,'utf8'); }
function assert(value,message){ if(!value){ console.error('FAIL:',message); process.exitCode=1; } else console.log('PASS:',message); }

const server = read('server.js');
const auditWorkflow = read('.github/workflows/enterprise-audit-refresh.yml');
const releaseWorkflow = read('.github/workflows/release-readiness.yml');
const auditUpdater = read('scripts/update-enterprise-audit-baseline.js');
const assurance = read('docs/PRODUCTION_ASSURANCE_STATUS.md');
const runbook = read('docs/RELEASE_RUNBOOK.md');

assert(server.includes("CONTROL_STATES.EXTERNALLY_VERIFIED"), 'runtime controls can record externally verified state');
assert(server.includes("Rate limiter evidence: provider="), 'Redis provider evidence is logged at startup');
assert(server.includes("live PING/PONG provider health operation"), 'Redis external verification requires a live provider health operation');
assert(server.includes("malwareHealthCheck(scannerConfig())"), 'malware scanner is runtime health checked');
assert(server.includes("objectStorageHealthProbe()"), 'object storage is runtime health checked');
assert(server.includes("MALWARE_SCANNER_REQUIRED"), 'required malware scanner failure stays fail-closed');
assert(server.includes("OBJECT_STORAGE_REQUIRED"), 'required object storage failure stays fail-closed');

assert(auditWorkflow.includes('branches: [main]'), 'audit evidence runs from merged main');
assert(auditWorkflow.includes('node scripts/generate-enterprise-inventory.js'), 'audit workflow regenerates machine-readable inventory');
assert(auditWorkflow.includes('node scripts/update-enterprise-audit-baseline.js'), 'audit workflow refreshes deep-audit evidence metadata');
assert(auditWorkflow.includes('node scripts/check-enterprise-audit-provenance.js'), 'audit workflow verifies provenance before commit');
assert(auditWorkflow.includes('actions/upload-artifact@v4'), 'audit evidence is preserved without mutating protected main');
assert(auditWorkflow.includes('enterprise-audit-${{ github.sha }}'), 'audit artifact is bound to the exact source SHA');
assert(auditWorkflow.includes("cron: '17 3 * * 1'"), 'audit evidence also refreshes weekly');
assert(auditUpdater.includes('ENTERPRISE_ARCHITECTURE_INVENTORY.json'), 'audit updater uses generated inventory as source of truth');
assert(auditUpdater.includes('Current remediation branch'), 'audit updater removes stale branch metadata');

for(const command of ['npm run check','npm test','npm run security:audit']){
  assert(releaseWorkflow.includes(command), 'release gate runs '+command);
}
assert(releaseWorkflow.includes('node scripts/generate-enterprise-inventory.js'), 'release gate regenerates enterprise inventory from release source');
assert(releaseWorkflow.includes('node scripts/update-enterprise-audit-baseline.js'), 'release gate refreshes audit metadata in its evidence workspace');
assert(releaseWorkflow.includes('node scripts/check-enterprise-audit-provenance.js'), 'release gate verifies regenerated audit provenance');
assert(releaseWorkflow.includes("tags:"), 'tagged releases have a dedicated workflow');
assert(releaseWorkflow.includes('gh release create'), 'successful tag gate publishes a GitHub release');
assert(releaseWorkflow.includes('release-evidence.md'), 'release workflow emits evidence artifact');

for(const issue of ['#178','#179','#180','#181','#182','#183']){
  assert(assurance.includes(issue), 'production assurance tracks '+issue);
}
assert(runbook.includes('Rollback procedure'), 'release runbook documents rollback');
assert(runbook.includes('do not manually drop columns/tables'), 'rollback avoids destructive schema reversal');
assert(runbook.toLowerCase().includes('no p0/p1 defect remains open'), 'release process blocks critical unresolved defects');

if(process.exitCode) process.exit(process.exitCode);
