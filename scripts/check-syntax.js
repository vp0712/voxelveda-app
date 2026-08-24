const { spawnSync } = require('child_process');
const path = require('path');

const files = [
  'app.js', 'server.js', 'config/urls.js',
  'controllers/attendanceController.js', 'controllers/authController.js', 'controllers/emailController.js',
  'controllers/invoiceController.js', 'controllers/materialController.js', 'controllers/timesheetWorkflowController.js',
  'controllers/financeController.js', 'controllers/financeOperationsController.js',
  'middleware/auth.js', 'middleware/pageAuth.js', 'middleware/securityMiddleware.js',
  'routes/attendanceRoutes.js', 'routes/authRoutes.js', 'routes/emailRoutes.js',
  'routes/financeRoutes.js',
  'services/auditService.js', 'services/emailQueue.js', 'services/emailService.js',
  'services/emailTemplates.js', 'services/notificationService.js',
  'services/timesheetWorkflowService.js', 'services/userLifecycleService.js',
  'services/financeDomain.js', 'services/financeSchema.js',
  'services/weeklyTimesheetScheduler.js', 'services/workforceSchema.js',
  'utils/session.js', 'utils/tokenRevocation.js', 'utils/money.js',
  'public/login.js', 'public/admin-dashboard.js', 'public/staff.js', 'public/qr-widget.js',
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
