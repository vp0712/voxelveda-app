const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'app.js', 'server.js', 'config/urls.js', 'config/databaseConfig.js',
  'controllers/attendanceController.js', 'controllers/authController.js', 'controllers/securityAuthController.js', 'controllers/mfaController.js', 'controllers/emailController.js',
  'controllers/invoiceController.js', 'controllers/materialController.js', 'controllers/timesheetWorkflowController.js', 'controllers/readinessController.js',
  'controllers/notificationController.js', 'controllers/trashController.js', 'controllers/workflowController.js', 'controllers/procurementController.js',
  'controllers/financeController.js', 'controllers/financeOperationsController.js', 'controllers/highRiskFinanceController.js', 'controllers/taskController.js', 'controllers/userController.js', 'controllers/stepUpController.js', 'controllers/securityDashboardController.js', 'controllers/securityGovernanceController.js', 'controllers/securityTelemetryController.js', 'controllers/operationalTrustController.js', 'controllers/continuousAssuranceController.js', 'controllers/integrationWebhookController.js',
  'middleware/auth.js', 'middleware/pageAuth.js', 'middleware/securityMiddleware.js', 'middleware/publicEndpointProtection.js', 'middleware/authorizationMiddleware.js', 'middleware/permissionMiddleware.js', 'middleware/inputPermissionMiddleware.js', 'middleware/requestContractMiddleware.js', 'middleware/securityContextMiddleware.js', 'middleware/stepUpMiddleware.js', 'middleware/highRiskPaymentMiddleware.js', 'middleware/sensitiveExportMiddleware.js',
  'routes/attendanceRoutes.js', 'routes/authRoutes.js', 'routes/emailRoutes.js', 'routes/uploadRoutes.js',
  'routes/notificationRoutes.js', 'routes/trashRoutes.js', 'routes/workflowRoutes.js', 'routes/procurementRoutes.js', 'routes/readinessRoutes.js',
  'routes/financeRoutes.js', 'routes/highRiskFinanceRoutes.js', 'routes/expenseRoutes.js', 'routes/invoiceRoutes.js', 'routes/taskRoutes.js', 'routes/userRoutes.js', 'routes/meetingRoutes.js', 'routes/rosterRoutes.js', 'routes/documentSecurityRoutes.js', 'routes/securityDashboardRoutes.js', 'routes/securityGovernanceRoutes.js', 'routes/operationalTrustRoutes.js', 'routes/continuousAssuranceRoutes.js', 'routes/integrationWebhookRoutes.js',
  'services/auditService.js', 'services/emailQueue.js', 'services/emailService.js', 'services/emailQueueWorker.js',
  'services/databaseRuntimeService.js', 'services/migrationRunner.js', 'services/runtimeState.js', 'services/rateLimitService.js', 'services/botChallengeService.js', 'services/publicSubmissionDedupeService.js',
  'services/emailTemplates.js', 'services/notificationService.js',
  'services/notificationSchema.js', 'services/trashSchema.js', 'services/trashService.js', 'services/trashPurgeService.js',
  'services/workflowSchema.js', 'services/workflowService.js', 'services/workflowEscalationService.js',
  'services/procurementSchema.js', 'services/procurementService.js',
  'services/timesheetWorkflowService.js', 'services/userLifecycleService.js',
  'services/financeDomain.js', 'services/financeSchema.js', 'services/financeEncryptionService.js', 'services/highRiskFinanceSchema.js', 'services/passwordPolicy.js',
  'services/securitySchema.js', 'services/sessionService.js', 'services/authSessionService.js', 'services/authActionTokenService.js', 'services/mfaService.js', 'services/authorizationService.js', 'services/stepUpService.js', 'services/userSecurityService.js', 'services/securityOperationsSchema.js', 'services/documentSecurityService.js', 'services/malwareScanService.js', 'services/paymentRiskService.js',
  'services/securityEmailService.js', 'services/operationalTrustSchema.js', 'services/assuranceSchema.js', 'services/securityGovernanceSchema.js', 'services/securityContextService.js', 'services/auditIntegrityService.js', 'services/securityEventOutboxService.js', 'services/segregationPolicyService.js', 'services/apiTokenService.js', 'services/webhookSecurityService.js', 'services/outboundRequestPolicy.js', 'services/aiSecurityPolicy.js', 'services/securityAlertService.js', 'config/security.js', 'config/permissionCatalog.js',
  'services/weeklyTimesheetScheduler.js', 'services/workforceSchema.js',
  'utils/session.js', 'utils/tokenRevocation.js', 'utils/money.js', 'utils/securityRedaction.js', 'utils/secureLogger.js',
  'public/login.js', 'public/auth-lifecycle.js', 'public/mfa.js', 'public/security-page.js', 'public/step-up.js',
  'public/admin-dashboard.js', 'public/staff.js', 'public/workflow-ui.js', 'public/procurement-ui.js', 'public/qr-widget.js',
  'public/service-worker.js', 'scripts/enterprise-wave-a-test.js', 'scripts/wave-b-pr1-platform-guards-test.js', 'scripts/generate-enterprise-inventory.js', 'scripts/check-enterprise-audit-provenance.js'
];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', file)], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`Syntax check passed for ${files.length} files.`);
