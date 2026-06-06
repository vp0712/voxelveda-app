const express = require('express');
const path = require('path');
const cors = require('cors');

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
app.use('/api/suppliers', auth, requirePermission('suppliers'), requireInputPermission('suppliers_input'), supplierRoutes);
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
