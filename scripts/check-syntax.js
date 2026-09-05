const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'app.js', 'server.js', 'config/urls.js',
  'controllers/attendanceController.js', 'controllers/authController.js', 'controllers/securityAuthController.js', 'controllers/mfaController.js', 'controllers/emailController.js',
  'controllers/invoiceController.js', 'controllers/materialController.js', 'controllers/timesheetWorkflowController.js',
  'controllers/financeController.js', 'controllers/financeOperationsController.js', 'controllers/highRiskFinanceController.js', 'controllers/taskController.js', 'controllers/userController.js', 'controllers/stepUpController.js',
  'middleware/auth.js', 'middleware/pageAuth.js', 'middleware/securityMiddleware.js', 'middleware/authorizationMiddleware.js', 'middleware/permissionMiddleware.js', 'middleware/inputPermissionMiddleware.js', 'middleware/stepUpMiddleware.js', 'middleware/highRiskPaymentMiddleware.js',
  'routes/attendanceRoutes.js', 'routes/authRoutes.js', 'routes/emailRoutes.js', 'routes/uploadRoutes.js',
  'routes/financeRoutes.js', 'routes/highRiskFinanceRoutes.js', 'routes/expenseRoutes.js', 'routes/invoiceRoutes.js', 'routes/taskRoutes.js', 'routes/userRoutes.js', 'routes/meetingRoutes.js', 'routes/rosterRoutes.js',
  'services/auditService.js', 'services/emailQueue.js', 'services/emailService.js',
  'services/emailTemplates.js', 'services/notificationService.js',
  'services/timesheetWorkflowService.js', 'services/userLifecycleService.js',
  'services/financeDomain.js', 'services/financeSchema.js', 'services/financeEncryptionService.js', 'services/highRiskFinanceSchema.js', 'services/passwordPolicy.js',
  'services/securitySchema.js', 'services/sessionService.js', 'services/authSessionService.js', 'services/authActionTokenService.js', 'services/mfaService.js', 'services/authorizationService.js', 'services/stepUpService.js', 'services/userSecurityService.js',
  'services/securityEmailService.js', 'config/security.js', 'config/permissionCatalog.js',
  'services/weeklyTimesheetScheduler.js', 'services/workforceSchema.js',
  'utils/session.js', 'utils/tokenRevocation.js', 'utils/money.js',
  'public/login.js', 'public/auth-lifecycle.js', 'public/mfa.js', 'public/security-page.js', 'public/step-up.js',
  'public/admin-dashboard.js', 'public/staff.js', 'public/qr-widget.js',
  'public/service-worker.js'
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
