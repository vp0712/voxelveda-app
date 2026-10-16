'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Explicit suite: original workflows, document delivery and current security
// all remain mandatory. Retired Banking/ERP boundaries have separate checks.
const checks = [
  'security-foundation-test.js',
  'android-canonical-test.js',
  'attendance-live-regression-test.js',
  'checkout-summary-test.js',
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
  'restored-security-scope-test.js',
  'retained-runtime-test.js',
  'retained-workspace-test.js',
  'retained-theme-test.js',
  'workspace-overlay-test.js',
  'profile-avatar-test.js',
  'profile-avatar-component-test.js',
  'notification-center-test.js',
  'notification-center-component-test.js',
  'attendance-qr-test.js',
  'attendance-gate-test.js',
  'attendance-display-test.js',
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
  'security-source-test.js',
  'original-workflow-test.js',
  'core-workflow-test.js',
  'core-roster-test.js',
  'staff-expense-workflow-test.js',
  'procurement-workflow-test.js',
  'invoice-workflow-regression-test.js',
  'invoice-summary-test.js',
  'document-pdf-delivery-test.js',
  'document-delivery-lifecycle-test.js',
  'document-module-isolation-test.js',
  'email-relay-review-test.js',
  'pdf-response-boundaries-test.js',
  'release-pdf-evidence-test.js',
  'procurement-import-extraction-test.js',
  'procurement-import-workflow-test.js',
  'procurement-report-pdf-test.js',
  'qms-restoration-workflow-test.js',
  'qms-document-stock-test.js',
  'original-report-test.js',
  'timesheet-preference-test.js',
  'weekly-timesheet-eligibility-test.js',
  'attendance-verified-summary-test.js',
  'weekly-timesheet-api-test.js',
  'weekly-timesheet-pdf-test.js',
  'timesheet-workflow-regression-test.js',
  'email-legacy-document-queue-test.js',
  'managed-weekly-email-queue-test.js',
  'external-link-safety-test.js'
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
console.log(`Application regression suite passed: ${checks.length} original workflows, PDFs, security, retirement and release checks.`);
