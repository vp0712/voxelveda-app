'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Explicit suite: missing checks fail the build. Removed product modules have
// retirement/access/data-preservation checks instead of obsolete feature tests.
const checks = [
  'security-foundation-test.js',
  'auth-lifecycle-test.js',
  'mfa-foundation-test.js',
  'authorization-foundation-test.js',
  'active-permission-boundaries-test.js',
  'step-up-authentication-test.js',
  'secure-user-management-test.js',
  'file-api-hardening-test.js',
  'security-role-matrix-test.js',
  'incident-response-test.js',
  'security-report-test.js',
  'production-readiness-test.js',
  'database-runtime-verification-test.js',
  'enterprise-wave-a-test.js',
  'wave-b-pr1-platform-guards-test.js',
  'wave-b-pr2-worker-safety-test.js',
  'backup-restore-assurance-test.js',
  'smtp-delivery-readiness-evidence-test.js',
  'customer-registration-test.js',
  'core-audit-isolation-test.js',
  'security-data-scope-test.js',
  'retained-runtime-test.js',
  'retained-workspace-test.js',
  'retained-theme-test.js',
  'retained-boundaries-test.js',
  'retained-migration-policy-test.js',
  'retained-document-boundary-test.js',
  'application-retirement-test.js',
  'global-brand-original-logo-test.js',
  'professional-loader-network-stability-test.js',
  'railway-startup-gateway-test.js',
  'release-assurance-test.js',
  'secret-scan.js',
  'source-file-inventory-test.js',
  'injection-sink-audit.js',
  'security-source-test.js'
];

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], {
    cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 120000
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error || result.status !== 0) {
    console.error(`Application regression failed: ${check} (${result.error?.code || result.status})`);
    process.exit(result.status || 1);
  }
}
console.log(`Application regression suite passed: ${checks.length} retained security, customer, retirement and release checks.`);
