const express = require('express');
const path = require('path');
const cors = require('cors');
const QRCode = require('qrcode');

const authRoutes = require('./routes/authRoutes');
const rfqRoutes = require('./routes/rfqRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const taskRoutes = require('./routes/taskRoutes');
const rfqController = require('./controllers/rfqController');
const aiLeadController = require('./controllers/aiLeadController');
const stockRoutes = require('./routes/stockRoutes');
const customerRoutes = require('./routes/customerRoutes');
const materialRoutes = require('./routes/materialRoutes');
const meetingRoutes = require('./routes/meetingRoutes');
const rosterRoutes = require('./routes/rosterRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const supplierController = require('./controllers/supplierController');
const attendanceController = require('./controllers/attendanceController');
const complianceRoutes = require('./routes/complianceRoutes');
const competitorRoutes = require('./routes/competitorRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const financeRoutes = require('./routes/financeRoutes');
const emailRoutes = require('./routes/emailRoutes');
const highRiskFinanceRoutes = require('./routes/highRiskFinanceRoutes');
const documentSecurityRoutes = require('./routes/documentSecurityRoutes');
const securityDashboardRoutes = require('./routes/securityDashboardRoutes');
const requirePermission = require('./middleware/permissionMiddleware');
const requireInputPermission = require('./middleware/inputPermissionMiddleware');
const { hasAnyPermission } = require('./services/authorizationService');
const pageAuth = require('./middleware/pageAuth');
const urls = require('./config/urls');
const {
  corsOptions,
  csrfProtection,
  rateLimit,
  securityHeaders,
  safeErrorHandler
} = require('./middleware/securityMiddleware');

const auth = require('./middleware/auth');

const app = express();
const publicDir = path.join(__dirname, 'public');
const noStorePublicAssets = new Set([
  'login.js',
  'admin-dashboard.js',
  'staff.js',
  'auth-lifecycle.js',
  'mfa.js',
  'security-page.js',
  'step-up.js',
  'step-up.css',
  'style.css',
  'advanced-theme.css',
  'mobile-shell.js',
  'service-worker.js'
]);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use(rateLimit());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || '1mb' }));
app.use(csrfProtection);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'voxel-veda-app',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res, next) => {
  if (process.env.FORCE_CANONICAL_HOST !== 'true' || req.path === '/api/health') return next();

  const currentHost = String(req.hostname || '').toLowerCase();
  const canonicalHost = new URL(urls.app).hostname;
  const fallbackHost = String(
    process.env.RAILWAY_FALLBACK_HOST || 'voxelveda-app-production.up.railway.app'
  ).toLowerCase();

  if (currentHost !== fallbackHost || currentHost === canonicalHost) return next();
  return res.redirect(302, new URL(req.originalUrl || '/', `${urls.app}/`).toString());
});

function noIndex(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

function sendPage(filename) {
  return (req, res) => res.sendFile(path.join(publicDir, filename));
}

function redirectPreservingQuery(target) {
  return (req, res) => {
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    return res.redirect(302, `${target}${query}`);
  };
}

app.get('/', sendPage('index.html'));
app.get('/login', noIndex, sendPage('login.html'));
app.get('/register', noIndex, sendPage('register.html'));
app.get('/request-quote', sendPage('customer.html'));
app.get('/privacy', sendPage('privacy-policy.html'));
app.get('/terms', sendPage('terms.html'));
app.get('/support', sendPage('support.html'));
app.get('/forgot-password', noIndex, sendPage('forgot-password.html'));
app.get('/reset-password', noIndex, sendPage('reset-password.html'));
app.get('/accept-invite', noIndex, sendPage('accept-invite.html'));
app.get('/mfa', noIndex, sendPage('mfa.html'));
app.get('/security', noIndex, pageAuth({ allowMfaSetup: true }), sendPage('security.html'));
app.get('/attendance-terminal', noIndex, sendPage('shift-qr.html'));
app.get('/401', noIndex, (req, res) => res.status(401).sendFile(path.join(publicDir, '401.html')));
app.get('/403', noIndex, (req, res) => res.status(403).sendFile(path.join(publicDir, '403.html')));
app.get('/404', noIndex, (req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
app.get('/429', noIndex, (req, res) => res.status(429).sendFile(path.join(publicDir, '429.html')));
app.get('/500', noIndex, (req, res) => res.status(500).sendFile(path.join(publicDir, '500.html')));
app.get('/maintenance', noIndex, (req, res) => res.status(503).sendFile(path.join(publicDir, 'maintenance.html')));

app.get('/admin', noIndex, pageAuth({ workspaceOnly: true }), sendPage('admin-dashboard.html'));
app.get('/dashboard', noIndex, pageAuth(), sendPage('staff-dashboard.html'));
app.get('/invoice/view', noIndex, pageAuth(), sendPage('invoice-pdf.html'));

app.get('/index.html', redirectPreservingQuery('/'));
app.get('/login.html', redirectPreservingQuery('/login'));
app.get('/register.html', redirectPreservingQuery('/register'));
app.get('/customer.html', redirectPreservingQuery('/request-quote'));
app.get('/privacy-policy.html', redirectPreservingQuery('/privacy'));
app.get('/admin-dashboard.html', redirectPreservingQuery('/admin'));
app.get('/staff-dashboard.html', redirectPreservingQuery('/dashboard'));
app.get('/dashboard.html', redirectPreservingQuery('/dashboard'));
app.get('/invoice-pdf.html', redirectPreservingQuery('/invoice/view'));
app.get('/shift-qr.html', redirectPreservingQuery('/attendance-terminal'));

const protectedModuleRoutes = [
  '/rfqs', '/invoices', '/customers', '/suppliers', '/stock', '/raw-material',
  '/packaging', '/expenses', '/workforce', '/timesheets', '/roster', '/staff',
  '/finance', '/financial-years', '/compliance', '/forms', '/settings', '/meetings', '/tasks'
];

app.get(protectedModuleRoutes, noIndex, pageAuth(), (req, res) => {
  const routeName = req.path.replace(/^\//, '');
  const portal = hasAnyPermission(req.user, [
    'VIEW_FINANCE', 'MANAGE_JOBS', 'MANAGE_TEAM_JOBS', 'VIEW_CUSTOMERS',
    'VIEW_INVENTORY', 'VIEW_SUPPLIERS', 'VIEW_RFQS'
  ])
    ? '/admin'
    : '/dashboard';
  return res.redirect(302, `${portal}?view=${encodeURIComponent(routeName)}`);
});

app.use(express.static(publicDir, {
  dotfiles: 'deny',
  index: false,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (noStorePublicAssets.has(path.basename(filePath))) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
  }
}));
app.use('/invoices', noIndex, auth, requirePermission('VIEW_FINANCE'), express.static(path.join(__dirname, 'invoices'), {
  dotfiles: 'deny',
  index: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
}));
app.use('/api/auth', authRoutes);

app.get('/api/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '').trim();
    if (!data || data.length > 1200) {
      return res.status(400).json({ message: 'A valid QR data value is required.' });
    }

    const png = await QRCode.toBuffer(data, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 8,
      width: 1024,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(png);
  } catch (err) {
    return res.status(500).json({ message: 'QR code generation failed.' });
  }
});

app.post('/api/public/rfq', rfqController.createRFQ);
app.post('/api/public/ai-lead', aiLeadController.createLead);
app.get('/api/public/shift-qr', attendanceController.publicShiftQrToken);

app.use('/api/rfq', auth, requirePermission('VIEW_RFQS'), rfqRoutes);
app.use('/api/invoice', auth, requirePermission('VIEW_FINANCE'), invoiceRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/settings', auth, settingsRoutes);
app.use('/api/email', auth, requirePermission('MANAGE_COMPANY_EMAIL'), emailRoutes);
app.use('/api/dashboard', auth, dashboardRoutes);
app.use('/api/upload', auth, uploadRoutes);
app.use('/api/documents', auth, documentSecurityRoutes);
app.use('/api/security', auth, securityDashboardRoutes);
app.use('/api/tasks', auth, taskRoutes);
app.use('/api/stock', auth, requirePermission('VIEW_INVENTORY'), stockRoutes);
app.use('/api/customers', auth, requirePermission('VIEW_CUSTOMERS'), requireInputPermission('EDIT_CUSTOMERS'), customerRoutes);
app.use('/api/materials', auth, requirePermission('VIEW_INVENTORY'), materialRoutes);
app.use('/api/meetings', auth, requirePermission('VIEW_MEETINGS'), meetingRoutes);
app.use('/api/roster', auth, requirePermission('VIEW_ATTENDANCE'), rosterRoutes);
app.get('/api/suppliers/files/:id/view', auth, requirePermission('VIEW_SUPPLIERS'), supplierController.viewSupplierFile);
app.use('/api/suppliers', auth, requirePermission('VIEW_SUPPLIERS'), supplierRoutes);
app.use('/api/expenses', auth, requirePermission('VIEW_FINANCE'), expenseRoutes);
app.use('/api/finance', auth, requirePermission('VIEW_FINANCE'), financeRoutes);
app.use('/api/high-risk-finance', auth, highRiskFinanceRoutes);
app.use('/api/compliance', auth, requirePermission('VIEW_COMPLIANCE'), requireInputPermission('EDIT_COMPLIANCE'), complianceRoutes);
app.use('/api/competitors', auth, requirePermission('VIEW_CUSTOMERS'), requireInputPermission('EDIT_CUSTOMERS'), competitorRoutes);
app.use('/api/access-attempts', auth, require('./routes/accessAttemptRoutes'));

try {
  app.use('/api/attendance', auth, requirePermission('VIEW_ATTENDANCE'), require('./routes/attendanceRoutes'));
} catch {
  console.log('Attendance routes not loaded.');
}

app.use((req, res) => {
  if (!req.path.startsWith('/api/') && req.accepts('html')) {
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  }
  return res.status(404).json({ message: 'Route not found' });
});

app.use(safeErrorHandler);

module.exports = app;
