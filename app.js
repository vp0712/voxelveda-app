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
const stockRoutes = require('./routes/stockRoutes');
const customerRoutes = require('./routes/customerRoutes');
const materialRoutes = require('./routes/materialRoutes');
const meetingRoutes = require('./routes/meetingRoutes');
const rosterRoutes = require('./routes/rosterRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const supplierController = require('./controllers/supplierController');
const complianceRoutes = require('./routes/complianceRoutes');
const competitorRoutes = require('./routes/competitorRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const requirePermission = require('./middleware/permissionMiddleware');
const requireInputPermission = require('./middleware/inputPermissionMiddleware');

const auth = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/invoices', express.static(path.join(__dirname, 'invoices')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

app.use('/api/rfq', auth, requirePermission('rfqs'), rfqRoutes);
app.use('/api/invoice', auth, requirePermission('invoices'), invoiceRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/settings', auth, settingsRoutes);
app.use('/api/dashboard', auth, dashboardRoutes);
app.use('/api/upload', auth, uploadRoutes);
app.use('/api/tasks', auth, taskRoutes);
app.use('/api/stock', auth, requirePermission('stock'), stockRoutes);
app.use('/api/customers', auth, requirePermission('customers'), requireInputPermission('customers_input'), customerRoutes);
app.use('/api/materials', auth, requirePermission('stock'), materialRoutes);
app.use('/api/meetings', auth, requirePermission('meetings'), meetingRoutes);
app.use('/api/roster', auth, requirePermission('roster'), rosterRoutes);
app.get('/api/suppliers/files/:id/view', auth, requirePermission('suppliers'), supplierController.viewSupplierFile);
app.use('/api/suppliers', auth, requirePermission('suppliers'), supplierRoutes);
app.use('/api/expenses', auth, requirePermission('expenses'), expenseRoutes);
app.use('/api/compliance', auth, requirePermission('compliance'), requireInputPermission('compliance_input'), complianceRoutes);
app.use('/api/competitors', auth, requirePermission('competitors'), requireInputPermission('competitors_input'), competitorRoutes);
app.use('/api/access-attempts', auth, require('./routes/accessAttemptRoutes'));

try {
  app.use('/api/attendance', auth, requirePermission('attendance'), require('./routes/attendanceRoutes'));
} catch {
  console.log('Attendance routes not loaded.');
}

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl
  });
});

module.exports = app;
