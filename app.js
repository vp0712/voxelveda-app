const express = require('express');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const rfqRoutes = require('./routes/rfqRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/invoices', express.static(path.join(__dirname, 'invoices')));

app.use('/api/auth', authRoutes);
app.use('/api/rfq', rfqRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

module.exports = app;