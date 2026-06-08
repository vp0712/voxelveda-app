const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

async function ensureInvoiceColumns() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_no VARCHAR(80) NULL,
      rfq_id INT NULL,
      customer_name VARCHAR(255) NULL,
      customer_email VARCHAR(255) NULL,
      description TEXT NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'draft',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      product_name VARCHAR(255) NULL,
      description TEXT NULL,
      qty DECIMAL(12,3) NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_items_invoice_id (invoice_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_activity (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      action_type VARCHAR(60) NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_activity_invoice_id (invoice_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_date DATE NULL,
      method VARCHAR(80) NULL,
      reference VARCHAR(120) NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_invoice_payments_invoice_id (invoice_id)
    )
  `);

  await pool.query(`ALTER TABLE invoices ADD COLUMN invoice_no VARCHAR(80) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN rfq_id INT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN customer_name VARCHAR(255) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN customer_email VARCHAR(255) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN description TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN total DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'draft'`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});

  await pool.query(`ALTER TABLE invoice_items ADD COLUMN product_name VARCHAR(255) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN qty DECIMAL(12,3) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN total DECIMAL(12,2) NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN description TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1`).catch(() => {});
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN amount DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`
    UPDATE invoice_items
    SET description = COALESCE(description, product_name),
        quantity = CASE WHEN quantity = 1 AND qty IS NOT NULL THEN qty ELSE quantity END,
        amount = CASE WHEN amount = 0 AND total IS NOT NULL THEN total ELSE amount END
  `).catch(() => {});
}

async function ensureInvoiceCustomerTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_name VARCHAR(180) NOT NULL,
      contact_name VARCHAR(180) NULL,
      email VARCHAR(180) NULL,
      phone VARCHAR(80) NULL,
      address TEXT NULL,
      notes TEXT NULL,
      file_link TEXT NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted TINYINT(1) NOT NULL DEFAULT 0
    )
  `);
}

async function rememberManualInvoiceCustomer(conn, { customerName, customerEmail, userId }) {
  const name = String(customerName || '').trim();
  const email = String(customerEmail || '').trim();
  if (!name || !email) return;

  const [[existing]] = await conn.query(
    'SELECT id FROM customers WHERE LOWER(email) = LOWER(?) AND deleted = 0 LIMIT 1',
    [email]
  );

  if (existing) {
    await conn.query(
      `
      UPDATE customers
      SET company_name = ?,
          email = ?,
          updated_by = ?
      WHERE id = ?
      `,
      [name, email, userId || null, existing.id]
    );
    return;
  }

  await conn.query(
    `
    INSERT INTO customers
      (company_name, email, notes, created_by)
    VALUES (?, ?, ?, ?)
    `,
    [name, email, 'Created automatically from manual invoice history.', userId || null]
  );
}

function invoiceReceivableSelect(whereClause = 'WHERE i.deleted = 0 OR i.deleted IS NULL') {
  return `
    SELECT
      i.*,
      COALESCE(p.paid_amount, 0) AS paid_amount,
      GREATEST(COALESCE(i.total, 0) - COALESCE(p.paid_amount, 0), 0) AS balance_due,
      CASE
        WHEN COALESCE(p.paid_amount, 0) <= 0 THEN 'unpaid'
        WHEN COALESCE(p.paid_amount, 0) >= COALESCE(i.total, 0) THEN 'paid'
        ELSE 'partial'
      END AS payment_state
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid_amount
      FROM invoice_payments
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    ${whereClause}
  `;
}

async function getInvoiceWithReceivables(invoiceId) {
  const [[invoice]] = await pool.query(
    `${invoiceReceivableSelect('WHERE i.id = ? AND (i.deleted = 0 OR i.deleted IS NULL)')} LIMIT 1`,
    [invoiceId]
  );
  return invoice;
}

function cleanPhoneForWhatsApp(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

async function buildCustomerStatementData({ search = '', customer_email = '', customer_name = '' }) {
  await ensureInvoiceColumns();

  const where = [];
  const params = [];

  if (customer_email) {
    where.push('LOWER(customer_email) = LOWER(?)');
    params.push(customer_email);
  } else if (customer_name) {
    where.push('LOWER(customer_name) = LOWER(?)');
    params.push(customer_name);
  }

  if (!where.length && search) {
    where.push('(customer_name LIKE ? OR customer_email LIKE ? OR invoice_no LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (!where.length) {
    throw new Error('Customer name, email, or search text is required');
  }

  const [invoices] = await pool.query(
    `
    SELECT *
    FROM (${invoiceReceivableSelect()}) receivables
    WHERE ${where.join(' OR ')}
    ORDER BY created_at ASC, id ASC
    `,
    params
  );

  const invoiceIds = invoices.map((invoice) => Number(invoice.id)).filter(Boolean);
  let payments = [];

  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `
      SELECT p.*, i.invoice_no, i.customer_name, i.customer_email
      FROM invoice_payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.invoice_id IN (${placeholders})
      ORDER BY p.payment_date ASC, p.id ASC
      `,
      invoiceIds
    );
    payments = rows;
  }

  const totals = invoices.reduce((acc, invoice) => {
    acc.invoice_value += Number(invoice.total || 0);
    acc.paid += Number(invoice.paid_amount || 0);
    acc.balance_due += Number(invoice.balance_due || 0);
    return acc;
  }, { invoice_value: 0, paid: 0, balance_due: 0 });

  const first = invoices[0] || {};
  return {
    customer: {
      name: customer_name || first.customer_name || search || 'Customer',
      email: customer_email || first.customer_email || ''
    },
    invoices,
    payments,
    totals
  };
}

/* ================= CREATE FROM RFQ ================= */

exports.createInvoice = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const { rfq_id } = req.body;

    if (!rfq_id) return res.status(400).json({ message: 'RFQ ID is required' });

    const [[rfq]] = await pool.query('SELECT * FROM rfqs WHERE id = ? LIMIT 1', [rfq_id]);

    if (!rfq) return res.status(404).json({ message: 'RFQ not found' });

    const rfqStatus = String(rfq.status || '').toLowerCase();

    if (rfqStatus === 'quoted') {
      const [[existingInvoice]] = await pool.query(
        'SELECT id, invoice_no FROM invoices WHERE rfq_id = ? AND (deleted = 0 OR deleted IS NULL) ORDER BY id DESC LIMIT 1',
        [rfq_id]
      );

      if (existingInvoice) {
        return res.json({
          message: 'Invoice already exists for this RFQ',
          invoice_id: existingInvoice.id,
          invoice_no: existingInvoice.invoice_no,
          existing: true
        });
      }
    }

    if (rfqStatus !== 'approved') {
      return res.status(400).json({
        message: 'RFQ must be approved first',
        current_status: rfq.status
      });
    }

    const invoiceNo = `INV-${String(Date.now()).slice(-6)}`;
    const quantity = Number(rfq.quantity || 1);
    const unitPrice = 120;
    const subtotal = quantity * unitPrice;
    const gstRate = 10;
    const gst = subtotal * (gstRate / 100);
    const total = subtotal + gst;
    const description = rfq.application || rfq.material || 'Advanced Manufacturing Service';

    const [result] = await pool.query(
      `
      INSERT INTO invoices
      (invoice_no, rfq_id, customer_name, customer_email, description, quantity, unit_price, gst_rate, total, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        invoiceNo,
        rfq_id,
        rfq.customer_name || 'Customer',
        rfq.email || '',
        description,
        quantity,
        unitPrice,
        gstRate,
        total,
        'draft'
      ]
    );

    const invoiceId = result.insertId;

    await pool.query(
      `
      INSERT INTO invoice_items
      (invoice_id, description, quantity, unit_price, amount)
      VALUES (?, ?, ?, ?, ?)
      `,
      [invoiceId, description, quantity, unitPrice, subtotal]
    );

    await pool.query("UPDATE rfqs SET status = 'quoted' WHERE id = ?", [rfq_id]);

    res.json({
      message: 'Invoice created successfully',
      invoice_id: invoiceId,
      invoice_no: invoiceNo
    });
  } catch (err) {
    console.error('CREATE INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice creation failed', error: err.message });
  }
};

/* ================= MANUAL INVOICE WITH MULTIPLE ITEMS ================= */

exports.createManualInvoice = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await ensureInvoiceColumns();
    await ensureInvoiceCustomerTable();

    const { customer_name, customer_email, gst_rate, items } = req.body;

    if (!customer_name || !customer_email) {
      return res.status(400).json({ message: 'Customer name and email are required' });
    }

    if (!Array.isArray(items) || items.length < 1) {
      return res.status(400).json({ message: 'At least one invoice item is required' });
    }

    if (items.length > 6) {
      return res.status(400).json({ message: 'Maximum 6 invoice items allowed' });
    }

    const cleanItems = items.map((item) => {
      const description = String(item.description || '').trim();
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const amount = quantity * unitPrice;

      return { description, quantity, unitPrice, amount };
    });

    const invalidItem = cleanItems.find(
      (item) => !item.description || item.quantity <= 0 || item.unitPrice <= 0
    );

    if (invalidItem) {
      return res.status(400).json({
        message: 'Each item must have description, quantity, and unit price'
      });
    }

    const gstRate = Number(gst_rate || 10);
    const subtotal = cleanItems.reduce((sum, item) => sum + item.amount, 0);
    const gst = subtotal * (gstRate / 100);
    const total = subtotal + gst;
    const invoiceNo = `INV-${String(Date.now()).slice(-6)}`;

    await conn.beginTransaction();

    const [result] = await conn.query(
      `
      INSERT INTO invoices
      (invoice_no, rfq_id, customer_name, customer_email, description, quantity, unit_price, gst_rate, total, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        invoiceNo,
        customer_name,
        customer_email,
        cleanItems[0].description,
        cleanItems[0].quantity,
        cleanItems[0].unitPrice,
        gstRate,
        total,
        'draft'
      ]
    );

    const invoiceId = result.insertId;

    for (const item of cleanItems) {
      await conn.query(
        `
        INSERT INTO invoice_items
        (invoice_id, description, quantity, unit_price, amount)
        VALUES (?, ?, ?, ?, ?)
        `,
        [invoiceId, item.description, item.quantity, item.unitPrice, item.amount]
      );
    }

    await rememberManualInvoiceCustomer(conn, {
      customerName: customer_name,
      customerEmail: customer_email,
      userId: req.user?.id
    });

    await conn.commit();

    res.json({
      message: 'Manual invoice created successfully',
      invoice_id: invoiceId,
      invoice_no: invoiceNo,
      total
    });
  } catch (err) {
    await conn.rollback();

    console.error('CREATE MANUAL INVOICE ERROR FULL:', err);

    res.status(500).json({
      message: 'Manual invoice creation failed',
      error: err.message
    });
  } finally {
    conn.release();
  }
};

/* ================= GET INVOICES ================= */

exports.getInvoices = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const [rows] = await pool.query(`
      ${invoiceReceivableSelect()}
      ORDER BY i.id ASC
    `);

    res.json({ invoices: rows });
  } catch (err) {
    console.error('GET INVOICES ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load invoices', error: err.message });
  }
};

exports.getInvoiceDetails = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ message: 'Invoice ID required' });

    const invoice = await getInvoiceWithReceivables(id);

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
      [id]
    );

    const [payments] = await pool.query(
      'SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date ASC, id ASC',
      [id]
    );

    res.json({ invoice, items, payments });
  } catch (err) {
    console.error('GET INVOICE DETAILS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load invoice details', error: err.message });
  }
};

exports.searchCustomerStatements = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const search = String(req.query.search || '').trim();
    if (search.length < 2) {
      return res.json({ matches: [] });
    }

    const [matches] = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(customer_email, ''), CONCAT('name:', customer_name)) AS customer_key,
        COALESCE(NULLIF(customer_name, ''), 'Customer') AS customer_name,
        COALESCE(customer_email, '') AS customer_email,
        COUNT(*) AS invoice_count,
        COALESCE(SUM(total), 0) AS invoice_value,
        COALESCE(SUM(paid_amount), 0) AS paid_amount,
        COALESCE(SUM(balance_due), 0) AS balance_due
      FROM (${invoiceReceivableSelect()}) receivables
      WHERE customer_name LIKE ? OR customer_email LIKE ? OR invoice_no LIKE ?
      GROUP BY customer_key, customer_name, customer_email
      ORDER BY balance_due DESC, customer_name ASC
      LIMIT 20
      `,
      [`%${search}%`, `%${search}%`, `%${search}%`]
    );

    res.json({ matches });
  } catch (err) {
    console.error('SEARCH CUSTOMER STATEMENTS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to search customer statements', error: err.message });
  }
};

exports.viewCustomerStatementPdf = async (req, res) => {
  try {
    const statement = await buildCustomerStatementData({
      search: String(req.query.search || '').trim(),
      customer_email: String(req.query.customer_email || '').trim(),
      customer_name: String(req.query.customer_name || '').trim()
    });

    if (!statement.invoices.length) {
      return res.status(404).json({ message: 'No invoice history found for this customer' });
    }

    const disposition = req.query.download ? 'attachment' : 'inline';
    const safeName = String(statement.customer.name || 'customer').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}-statement.pdf"`);

    const doc = createCustomerStatementPdfDocument(statement);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('CUSTOMER STATEMENT PDF ERROR FULL:', err);
    res.status(500).json({ message: 'Statement PDF generation failed', error: err.message });
  }
};

exports.sendCustomerStatement = async (req, res) => {
  try {
    const statement = await buildCustomerStatementData({
      search: String(req.body.search || '').trim(),
      customer_email: String(req.body.customer_email || '').trim(),
      customer_name: String(req.body.customer_name || '').trim()
    });

    if (!statement.invoices.length) {
      return res.status(404).json({ message: 'No invoice history found for this customer' });
    }

    const email = String(req.body.email || statement.customer.email || '').trim();
    const mobile = String(req.body.mobile || '').trim();
    let emailSent = false;
    let whatsappUrl = '';

    if (email) {
      const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
      const missing = required.filter((key) => !process.env[key]);

      if (missing.length) {
        return res.status(500).json({
          message: `Email is not configured. Missing: ${missing.join(', ')}`
        });
      }

      const pdfBuffer = await buildCustomerStatementPdfBuffer(statement);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE || 'true') === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: `"${process.env.FROM_NAME || 'Voxel Veda'}" <${process.env.FROM_EMAIL}>`,
        to: email,
        subject: `Voxel Veda account statement - ${statement.customer.name}`,
        text: `Hello ${statement.customer.name},\n\nPlease find attached your Voxel Veda account statement.\n\nInvoice value: $${statement.totals.invoice_value.toFixed(2)}\nPayment received: $${statement.totals.paid.toFixed(2)}\nBalance due: $${statement.totals.balance_due.toFixed(2)}\n\nThank you,\nVoxel Veda`,
        attachments: [{
          filename: 'voxel-veda-account-statement.pdf',
          content: pdfBuffer,
          contentType: 'application/pdf'
        }]
      });

      emailSent = true;
    }

    if (mobile) {
      const phone = cleanPhoneForWhatsApp(mobile);
      const message = [
        `Voxel Veda account statement for ${statement.customer.name}`,
        `Invoice value: $${statement.totals.invoice_value.toFixed(2)}`,
        `Payment received: $${statement.totals.paid.toFixed(2)}`,
        `Balance due: $${statement.totals.balance_due.toFixed(2)}`,
        'Please contact Voxel Veda accounts for any queries.'
      ].join('\n');
      whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    }

    res.json({
      message: emailSent
        ? (whatsappUrl ? 'Statement emailed. WhatsApp message is ready.' : 'Statement emailed successfully.')
        : (whatsappUrl ? 'WhatsApp message is ready.' : 'Choose email or mobile to send the statement.'),
      email_sent: emailSent,
      whatsapp_url: whatsappUrl
    });
  } catch (err) {
    console.error('SEND CUSTOMER STATEMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Statement send failed', error: err.message });
  }
};

/* ================= STATUS ACTIONS ================= */

exports.approveInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });

    const [result] = await pool.query(
      "UPDATE invoices SET status = 'approved' WHERE id = ?",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    await logInvoiceActivity(invoice_id, 'approved', 'Invoice approved by admin');

    res.json({ message: 'Invoice approved successfully' });
  } catch (err) {
    console.error('APPROVE INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice approval failed', error: err.message });
  }
};

exports.sendInvoice = async (req, res) => {
  try {
    const { invoice_id, email, mobile } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });
    if (!email && !mobile) return res.status(400).json({ message: 'Enter customer email or mobile number' });

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ? LIMIT 1', [invoice_id]);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    let emailSent = false;
    let smsSent = false;

    if (email) {
      const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
      const missing = required.filter((key) => !process.env[key]);

      if (missing.length) {
        return res.status(500).json({
          message: `Email is not configured. Missing: ${missing.join(', ')}`
        });
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE || 'true') === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const pdfBuffer = await buildInvoicePdfBuffer(invoice_id);

      await transporter.sendMail({
        from: `"${process.env.FROM_NAME || 'Voxel Veda'}" <${process.env.FROM_EMAIL}>`,
        to: email,
        subject: `Invoice ${invoice.invoice_no || invoice_id} from Voxel Veda`,
        text: `Hello ${invoice.customer_name || 'Customer'},\n\nPlease find attached invoice ${invoice.invoice_no || invoice_id}.\n\nThank you,\nVoxel Veda`,
        attachments: [
          {
            filename: `${invoice.invoice_no || `invoice-${invoice_id}`}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      });

      emailSent = true;
    }

    if (mobile && process.env.SMS_WEBHOOK_URL) {
      const pdfLink = `${req.protocol}://${req.get('host')}/api/invoice/${invoice_id}/pdf`;
      const smsRes = await fetch(process.env.SMS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: mobile,
          message: `Voxel Veda invoice ${invoice.invoice_no || invoice_id}: ${pdfLink}`,
          invoice_id,
          invoice_no: invoice.invoice_no
        })
      });

      smsSent = smsRes.ok;
    }

    const [result] = await pool.query(
      "UPDATE invoices SET status = 'sent' WHERE id = ?",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    const notes = [
      email ? `Email: ${email}` : '',
      mobile ? `Mobile: ${mobile}` : '',
      emailSent ? 'PDF emailed' : '',
      smsSent ? 'SMS webhook sent' : '',
      mobile && !smsSent ? 'Mobile delivery saved for follow-up' : ''
    ].filter(Boolean).join(' | ');

    await logInvoiceActivity(invoice_id, 'sent', notes || 'Invoice marked as sent');

    res.json({
      message: emailSent
        ? (smsSent ? 'Invoice PDF emailed and mobile notification sent' : 'Invoice PDF emailed successfully')
        : (smsSent ? 'Mobile invoice notification sent' : 'Invoice marked as sent. Mobile SMS provider is not configured yet.'),
      email_sent: emailSent,
      sms_sent: smsSent,
      mobile_recorded: Boolean(mobile)
    });
  } catch (err) {
    console.error('SEND INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice send failed', error: err.message });
  }
};

exports.markInvoicePaid = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const { invoice_id } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });

    const invoice = await getInvoiceWithReceivables(invoice_id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const balanceDue = Number(invoice.balance_due || 0);

    if (balanceDue > 0) {
      await pool.query(
        `
        INSERT INTO invoice_payments
        (invoice_id, amount, payment_date, method, reference, notes, created_by)
        VALUES (?, ?, CURDATE(), ?, ?, ?, ?)
        `,
        [
          invoice_id,
          balanceDue,
          'Marked paid',
          invoice.invoice_no || '',
          'Full remaining balance marked as paid',
          req.user?.id || null
        ]
      );
    }

    const [result] = await pool.query(
      "UPDATE invoices SET status = 'paid' WHERE id = ? AND (deleted = 0 OR deleted IS NULL)",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    await logInvoiceActivity(invoice_id, 'paid', `Invoice marked as paid. Payment captured: ${balanceDue.toFixed(2)}`);

    res.json({ message: 'Invoice marked as paid' });
  } catch (err) {
    console.error('MARK INVOICE PAID ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice paid update failed', error: err.message });
  }
};

exports.recordInvoicePayment = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const invoiceId = Number(req.body.invoice_id || 0);
    const amount = Number(req.body.amount || 0);
    const paymentDate = String(req.body.payment_date || '').trim() || new Date().toISOString().slice(0, 10);
    const method = String(req.body.method || 'Bank transfer').trim();
    const reference = String(req.body.reference || '').trim();
    const notes = String(req.body.notes || '').trim();

    if (!invoiceId) return res.status(400).json({ message: 'Invoice ID required' });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than zero' });
    }

    const invoice = await getInvoiceWithReceivables(invoiceId);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const balanceDue = Number(invoice.balance_due || 0);
    if (balanceDue <= 0) {
      return res.status(400).json({ message: 'This invoice is already fully paid' });
    }

    if (amount > balanceDue + 0.009) {
      return res.status(400).json({
        message: `Payment cannot exceed balance due of $${balanceDue.toFixed(2)}`
      });
    }

    await pool.query(
      `
      INSERT INTO invoice_payments
      (invoice_id, amount, payment_date, method, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [invoiceId, amount, paymentDate, method, reference, notes, req.user?.id || null]
    );

    const refreshed = await getInvoiceWithReceivables(invoiceId);
    const fullyPaid = Number(refreshed.balance_due || 0) <= 0.009;

    if (fullyPaid) {
      await pool.query("UPDATE invoices SET status = 'paid' WHERE id = ?", [invoiceId]);
    } else if (String(invoice.status || '').toLowerCase() === 'draft') {
      await pool.query("UPDATE invoices SET status = 'sent' WHERE id = ?", [invoiceId]);
    }

    await logInvoiceActivity(
      invoiceId,
      'payment',
      `Payment received: $${amount.toFixed(2)} via ${method}${reference ? ` | Ref: ${reference}` : ''}`
    );

    const finalInvoice = await getInvoiceWithReceivables(invoiceId);
    res.json({
      message: fullyPaid ? 'Payment saved. Invoice is fully paid.' : 'Payment saved. Balance updated.',
      invoice: finalInvoice
    });
  } catch (err) {
    console.error('RECORD INVOICE PAYMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice payment failed', error: err.message });
  }
};

exports.deleteInvoicePayment = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const invoiceId = Number(req.body.invoice_id || 0);
    const paymentId = Number(req.body.payment_id || 0);

    if (!invoiceId || !paymentId) {
      return res.status(400).json({ message: 'Invoice ID and payment ID are required' });
    }

    const [[payment]] = await pool.query(
      'SELECT * FROM invoice_payments WHERE id = ? AND invoice_id = ? LIMIT 1',
      [paymentId, invoiceId]
    );

    if (!payment) return res.status(404).json({ message: 'Payment entry not found' });

    await pool.query('DELETE FROM invoice_payments WHERE id = ? AND invoice_id = ?', [paymentId, invoiceId]);

    const invoice = await getInvoiceWithReceivables(invoiceId);
    if (invoice && Number(invoice.balance_due || 0) > 0 && String(invoice.status || '').toLowerCase() === 'paid') {
      await pool.query("UPDATE invoices SET status = 'sent' WHERE id = ?", [invoiceId]);
    }

    await logInvoiceActivity(invoiceId, 'payment_deleted', `Payment deleted: $${Number(payment.amount || 0).toFixed(2)}`);

    res.json({ message: 'Payment entry deleted' });
  } catch (err) {
    console.error('DELETE INVOICE PAYMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice payment delete failed', error: err.message });
  }
};

/* ================= REJECT / DELETE / EDIT ================= */

exports.rejectInvoice = async (req, res) => {
  try {
    const { invoice_id, reason } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });

    const [result] = await pool.query(
      "UPDATE invoices SET status = 'rejected' WHERE id = ?",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    await logInvoiceActivity(invoice_id, 'rejected', reason || 'No reason provided');

    res.json({ message: 'Invoice rejected successfully' });
  } catch (err) {
    console.error('REJECT INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice reject failed', error: err.message });
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });

    const [result] = await pool.query(
      "UPDATE invoices SET deleted = 1 WHERE id = ?",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    await logInvoiceActivity(invoice_id, 'deleted', 'Invoice soft deleted by admin');

    res.json({ message: 'Invoice deleted successfully' });
  } catch (err) {
    console.error('DELETE INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice delete failed', error: err.message });
  }
};

exports.editInvoice = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await ensureInvoiceColumns();

    const invoiceId = Number(req.body.invoice_id || 0);
    const invoiceNo = String(req.body.invoice_no || '').trim();
    const customerName = String(req.body.customer_name || 'Customer').trim() || 'Customer';
    const customerEmail = String(req.body.customer_email || '').trim();
    const gstRate = Number(req.body.gst_rate ?? 10);
    const status = String(req.body.status || 'draft').trim().toLowerCase();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!invoiceId || !invoiceNo) {
      return res.status(400).json({ message: 'Invoice ID and invoice number are required' });
    }

    if (!['draft', 'approved', 'sent', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid invoice status' });
    }

    if (Number.isNaN(gstRate) || gstRate < 0) {
      return res.status(400).json({ message: 'Invalid GST rate' });
    }

    if (!items.length || items.length > 12) {
      return res.status(400).json({ message: 'Invoice must have 1 to 12 items' });
    }

    const cleanItems = items.map((item) => {
      const description = String(item.description || '').trim();
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      return {
        description,
        quantity,
        unitPrice,
        amount: quantity * unitPrice
      };
    });

    const invalidItem = cleanItems.find((item) => !item.description || item.quantity <= 0 || item.unitPrice < 0);
    if (invalidItem) {
      return res.status(400).json({ message: 'Each item needs description, quantity, and valid unit price' });
    }

    const subtotal = cleanItems.reduce((sum, item) => sum + item.amount, 0);
    const total = subtotal + (subtotal * (gstRate / 100));

    await conn.beginTransaction();

    const [duplicateRows] = await conn.query(
      'SELECT id FROM invoices WHERE invoice_no = ? AND id <> ? AND (deleted = 0 OR deleted IS NULL) LIMIT 1',
      [invoiceNo, invoiceId]
    );

    if (duplicateRows.length) {
      await conn.rollback();
      return res.status(400).json({ message: 'Invoice number already exists' });
    }

    const [result] = await conn.query(
      `
      UPDATE invoices
      SET invoice_no = ?,
          customer_name = ?,
          customer_email = ?,
          description = ?,
          quantity = ?,
          unit_price = ?,
          gst_rate = ?,
          total = ?,
          status = ?
      WHERE id = ?
      AND (deleted = 0 OR deleted IS NULL)
      `,
      [
        invoiceNo,
        customerName,
        customerEmail,
        cleanItems[0].description,
        cleanItems[0].quantity,
        cleanItems[0].unitPrice,
        gstRate,
        total,
        status,
        invoiceId
      ]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Invoice not found' });
    }

    await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);

    for (const item of cleanItems) {
      await conn.query(
        `
        INSERT INTO invoice_items
        (invoice_id, description, quantity, unit_price, amount)
        VALUES (?, ?, ?, ?, ?)
        `,
        [invoiceId, item.description, item.quantity, item.unitPrice, item.amount]
      );
    }

    await logInvoiceActivity(invoiceId, 'edited', `Invoice ${invoiceNo} edited. Total ${total.toFixed(2)}`);
    await conn.commit();

    res.json({ message: 'Invoice updated successfully', total });
  } catch (err) {
    await conn.rollback();
    console.error('EDIT INVOICE ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice edit failed', error: err.message });
  } finally {
    conn.release();
  }
};

async function logInvoiceActivity(invoiceId, actionType, notes) {
  try {
    await pool.query(
      `
      INSERT INTO invoice_activity
      (invoice_id, action_type, notes)
      VALUES (?, ?, ?)
      `,
      [invoiceId, actionType, notes || '']
    );
  } catch (err) {
    console.error('INVOICE ACTIVITY LOG ERROR:', err.message);
  }
}

/* ================= PDF ================= */

exports.viewInvoicePdf = async (req, res) => {
  try {
    await ensureInvoiceColumns();

    const { id } = req.params;

    const invoice = await getInvoiceWithReceivables(id);

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
      [id]
    );

    const invoiceItems = items.length
      ? items
      : [{
          description: invoice.description || 'Advanced Manufacturing Service',
          quantity: Number(invoice.quantity || 1),
          unit_price: Number(invoice.unit_price || 0),
          amount: Number(invoice.quantity || 1) * Number(invoice.unit_price || 0)
        }];

    const disposition = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${invoice.invoice_no || 'invoice'}.pdf"`);

    const doc = createInvoicePdfDocument(invoice, invoiceItems, id);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    console.error('PDF ERROR FULL:', err);
    res.status(500).json({
      message: 'PDF generation failed',
      error: err.message
    });
  }
};

async function buildInvoicePdfBuffer(id) {
  await ensureInvoiceColumns();

  const invoice = await getInvoiceWithReceivables(id);

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const [items] = await pool.query(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
    [id]
  );

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = createInvoicePdfDocument(invoice, items, id);
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function buildCustomerStatementPdfBuffer(statement) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = createCustomerStatementPdfDocument(statement);
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function createInvoicePdfDocument(invoice, items, id) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  renderInvoicePdf(doc, invoice, items, id);
  return doc;
}

function createCustomerStatementPdfDocument(statement) {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  renderCustomerStatementPdf(doc, statement);
  return doc;
}

function drawStatementHeader(doc, title, subtitle = '') {
  const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png');
  const W = doc.page.width;
  const navy = '#07111f';
  const accent = '#12b3c7';

  doc.rect(0, 0, W, 104).fill(navy);
  doc.rect(0, 104, W, 3).fill(accent);

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 44, 18, { width: 74 });
    } catch {
      doc.fillColor('#ffffff').fontSize(18).text('VOXEL VEDA', 44, 38);
    }
  }

  doc.fillColor('#ffffff').fontSize(22).text(title, 148, 30, { width: 370, align: 'right' });
  doc.fillColor('#b6f4ff').fontSize(9).text(subtitle, 148, 62, { width: 370, align: 'right' });
}

function statementMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function drawScanSafeQr(doc, qrPath, targetUrl, x, y, size) {
  const quiet = 7;
  const outer = size + (quiet * 2);
  doc.roundedRect(x - quiet, y - quiet, outer, outer, 5).fill('#ffffff').strokeColor('#d7dee8').stroke();
  if (fs.existsSync(qrPath)) {
    doc.image(qrPath, x, y, { width: size });
    doc.link(x - quiet, y - quiet, outer, outer, targetUrl);
  }
}

function renderCustomerStatementPdf(doc, statement) {
  const ink = '#0f172a';
  const muted = '#64748b';
  const line = '#d7dee8';
  const panel = '#f8fafc';
  const navy = '#07111f';
  const accent = '#12b3c7';
  const privacyQrPath = path.join(__dirname, '..', 'public', 'privacy-qr.png');
  const privacyPolicyUrl = 'https://voxelveda-app-production.up.railway.app/privacy-policy.html';

  drawStatementHeader(doc, 'ACCOUNT STATEMENT', 'Payment record, invoice history and balance due');

  let y = 132;
  doc.fillColor(ink).fontSize(10).text('Customer', 44, y);
  doc.fillColor(ink).fontSize(17).text(statement.customer.name || 'Customer', 44, y + 16);
  doc.fillColor(muted).fontSize(9).text(statement.customer.email || '-', 44, y + 38);
  doc.fillColor(muted).fontSize(9).text(`Generated: ${new Date().toLocaleDateString('en-AU')}`, 380, y + 16, { width: 160, align: 'right' });

  y += 78;
  const summary = [
    ['Invoice Value', statement.totals.invoice_value],
    ['Payments Taken', statement.totals.paid],
    ['Debt / Balance Left', statement.totals.balance_due]
  ];

  summary.forEach(([label, value], index) => {
    const x = 44 + (index * 170);
    doc.roundedRect(x, y, 154, 72, 10).fill(panel).strokeColor(line).stroke();
    doc.fillColor(muted).fontSize(8).text(label.toUpperCase(), x + 14, y + 14);
    doc.fillColor(index === 2 && Number(value) > 0 ? '#dc2626' : ink).fontSize(16).text(statementMoney(value), x + 14, y + 34);
  });

  y += 104;
  doc.fillColor(ink).fontSize(14).text('Invoice History', 44, y);
  y += 22;
  doc.roundedRect(44, y, 508, 28, 7).fill(navy);
  doc.fillColor('#ffffff').fontSize(8);
  doc.text('DATE', 58, y + 10, { width: 64 });
  doc.text('INVOICE', 124, y + 10, { width: 72 });
  doc.text('STATUS', 202, y + 10, { width: 58 });
  doc.text('TOTAL', 286, y + 10, { width: 70, align: 'right' });
  doc.text('PAID', 372, y + 10, { width: 70, align: 'right' });
  doc.text('BALANCE', 458, y + 10, { width: 70, align: 'right' });

  y += 34;
  statement.invoices.slice(0, 18).forEach((invoice, index) => {
    if (y > 700) {
      doc.addPage();
      drawStatementHeader(doc, 'ACCOUNT STATEMENT', 'Continued invoice history');
      y = 132;
    }

    doc.roundedRect(44, y, 508, 28, 5)
      .fill(index % 2 ? '#ffffff' : panel)
      .strokeColor('#e5eaf0')
      .stroke();
    const date = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-AU') : '-';
    doc.fillColor(ink).fontSize(8);
    doc.text(date, 58, y + 9, { width: 64 });
    doc.text(invoice.invoice_no || `#${invoice.id}`, 124, y + 9, { width: 72 });
    doc.text(String(invoice.status || '-'), 202, y + 9, { width: 58 });
    doc.text(statementMoney(invoice.total), 286, y + 9, { width: 70, align: 'right' });
    doc.text(statementMoney(invoice.paid_amount), 372, y + 9, { width: 70, align: 'right' });
    doc.text(statementMoney(invoice.balance_due), 458, y + 9, { width: 70, align: 'right' });
    y += 32;
  });

  y += 18;
  if (y > 650) {
    doc.addPage();
    drawStatementHeader(doc, 'ACCOUNT STATEMENT', 'Payment ledger');
    y = 132;
  }

  doc.fillColor(ink).fontSize(14).text('Payment Ledger', 44, y);
  y += 22;

  if (!statement.payments.length) {
    doc.roundedRect(44, y, 508, 36, 8).fill(panel).strokeColor(line).stroke();
    doc.fillColor(muted).fontSize(9).text('No payments have been recorded for this customer yet.', 58, y + 13);
    y += 52;
  } else {
    doc.roundedRect(44, y, 508, 28, 7).fill(navy);
    doc.fillColor('#ffffff').fontSize(8);
    doc.text('DATE', 58, y + 10, { width: 70 });
    doc.text('INVOICE', 132, y + 10, { width: 80 });
    doc.text('METHOD', 220, y + 10, { width: 90 });
    doc.text('REFERENCE', 318, y + 10, { width: 92 });
    doc.text('AMOUNT', 458, y + 10, { width: 70, align: 'right' });
    y += 34;

    statement.payments.slice(0, 22).forEach((payment, index) => {
      if (y > 710) {
        doc.addPage();
        drawStatementHeader(doc, 'ACCOUNT STATEMENT', 'Continued payment ledger');
        y = 132;
      }

      doc.roundedRect(44, y, 508, 28, 5)
        .fill(index % 2 ? '#ffffff' : panel)
        .strokeColor('#e5eaf0')
        .stroke();
      doc.fillColor(ink).fontSize(8);
      doc.text(payment.payment_date ? new Date(payment.payment_date).toLocaleDateString('en-AU') : '-', 58, y + 9, { width: 70 });
      doc.text(payment.invoice_no || `#${payment.invoice_id}`, 132, y + 9, { width: 80 });
      doc.text(payment.method || '-', 220, y + 9, { width: 90 });
      doc.text(payment.reference || '-', 318, y + 9, { width: 92 });
      doc.text(statementMoney(payment.amount), 458, y + 9, { width: 70, align: 'right' });
      y += 32;
    });
  }

  if (y > 690) {
    doc.addPage();
    drawStatementHeader(doc, 'ACCOUNT STATEMENT', 'Privacy and payment notes');
    y = 132;
  }

  doc.roundedRect(44, y, 508, 82, 8).fill(panel).strokeColor(line).stroke();
  doc.fillColor('#0b4f6c').fontSize(9).text('Privacy, confidentiality & payment handling', 58, y + 10);
  doc.fillColor(muted).fontSize(7.5).text(
    'This statement may contain confidential customer, invoice, pricing and payment information. Scan the QR code to view the live Voxel Veda privacy policy.',
    58,
    y + 26,
    { width: 356, lineGap: 1 }
  );
  doc.fillColor('#0b4f6c').fontSize(7).text(privacyPolicyUrl.replace(/^https?:\/\//, ''), 58, y + 58, { width: 356 });
  drawScanSafeQr(doc, privacyQrPath, privacyPolicyUrl, 474, y + 12, 58);

  y += 102;
  doc.fillColor(ink).fontSize(10).text('Payment reference', 44, y);
  doc.fillColor(muted).fontSize(8).text('Please use the invoice number as payment reference. Contact Voxel Veda accounts for corrections or questions.', 44, y + 16, { width: 360 });
  doc.fillColor(ink).fontSize(9).text('Voxel Veda Pty Ltd', 420, y);
  doc.fillColor(muted).fontSize(8).text('Innovation in Motion', 420, y + 16);
}

function renderInvoicePdf(doc, invoice, items, id) {
  const invoiceItems = items.length
    ? items
    : [{
        description: invoice.description || 'Advanced Manufacturing Service',
        quantity: Number(invoice.quantity || 1),
        unit_price: Number(invoice.unit_price || 0),
        amount: Number(invoice.quantity || 1) * Number(invoice.unit_price || 0)
      }];

  const gstRate = Number(invoice.gst_rate || 10);
  const subtotal = invoiceItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const gst = subtotal * (gstRate / 100);
  const total = subtotal + gst;
  const paidAmount = Number(invoice.paid_amount || 0);
  const balanceDue = Math.max(total - paidAmount, 0);
  const invoiceDate = invoice.created_at
    ? new Date(invoice.created_at).toLocaleDateString('en-AU')
    : new Date().toLocaleDateString('en-AU');
  const dueDate = new Date(invoice.created_at || Date.now());
  dueDate.setDate(dueDate.getDate() + 7);

  const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png');
  const privacyQrPath = path.join(__dirname, '..', 'public', 'privacy-qr.png');
  const privacyPolicyUrl = 'https://voxelveda-app-production.up.railway.app/privacy-policy.html';
  const W = doc.page.width;
  const H = doc.page.height;
  const navy = '#07111f';
  const ink = '#0f172a';
  const muted = '#64748b';
  const line = '#d7dee8';
  const panel = '#f8fafc';
  const accent = '#12b3c7';
  const accentDark = '#0b4f6c';

  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 116).fill(navy);
  doc.rect(0, 116, W, 3).fill(accent);
  doc.polygon([W - 155, 0], [W, 0], [W, 116], [W - 92, 116]).fill('#0c223b');
  doc.polygon([W - 76, 0], [W, 0], [W, 58]).fill(accentDark);

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 48, 12, { width: 92 });
    } catch {
      doc.fillColor('#ffffff').fontSize(22).text('VOXEL VEDA', 48, 42);
    }
  } else {
    doc.fillColor('#ffffff').fontSize(22).text('VOXEL VEDA', 48, 42);
  }

  doc.fillColor('#ffffff').fontSize(30).text('INVOICE', 386, 34, { width: 160, align: 'right' });
  doc.fillColor('#b6f4ff').fontSize(9).text('ENGINEERING OPERATIONS', 386, 72, { width: 160, align: 'right' });

  doc.fillColor(ink).fontSize(9).text('Issued by', 48, 145);
  doc.fillColor(ink).fontSize(16).text('Voxel Veda Pty Ltd', 48, 161);
  doc.fillColor(muted).fontSize(9);
  doc.text('Advanced manufacturing and engineering services', 48, 184);
  doc.text('info@voxelveda.com | www.voxelveda.com', 48, 199);

  const metaX = 366;
  doc.roundedRect(metaX, 142, 182, 94, 8).fill(panel).strokeColor(line).stroke();
  doc.fillColor(muted).fontSize(8).text('INVOICE NO', metaX + 16, 158);
  doc.fillColor(ink).fontSize(12).text(invoice.invoice_no || `INV-${id}`, metaX + 16, 172);
  doc.fillColor(muted).fontSize(8).text('INVOICE DATE', metaX + 16, 196);
  doc.fillColor(ink).fontSize(10).text(invoiceDate, metaX + 16, 210);
  doc.fillColor(muted).fontSize(8).text('DUE DATE', metaX + 106, 196);
  doc.fillColor(ink).fontSize(10).text(dueDate.toLocaleDateString('en-AU'), metaX + 106, 210);

  doc.roundedRect(48, 262, 500, 76, 10).fill(panel).strokeColor(line).stroke();
  doc.fillColor(accentDark).fontSize(9).text('BILL TO', 68, 282);
  doc.fillColor(ink).fontSize(14).text(invoice.customer_name || 'Customer', 68, 299, { width: 300 });
  doc.fillColor(muted).fontSize(10).text(invoice.customer_email || '-', 68, 318, { width: 300 });

  const tableX = 48;
  const tableY = 376;
  const tableW = 500;
  const rowH = 42;

  doc.roundedRect(tableX, tableY, tableW, 36, 8).fill(navy);
  doc.fillColor('#ffffff').fontSize(9);
  doc.text('DESCRIPTION', tableX + 18, tableY + 13, { width: 230 });
  doc.text('QTY', tableX + 280, tableY + 13, { width: 42, align: 'right' });
  doc.text('UNIT', tableX + 350, tableY + 13, { width: 56, align: 'right' });
  doc.text('AMOUNT', tableX + 424, tableY + 13, { width: 58, align: 'right' });

  let y = tableY + 48;
  invoiceItems.slice(0, 10).forEach((item, index) => {
    doc.roundedRect(tableX, y - 8, tableW, rowH, 6)
      .fill(index % 2 === 0 ? '#ffffff' : '#f8fafc')
      .strokeColor('#e5eaf0')
      .stroke();
    doc.fillColor(ink).fontSize(10).text(item.description || 'Item', tableX + 18, y + 6, { width: 230 });
    doc.fillColor(muted).fontSize(9).text(String(Number(item.quantity || 0)), tableX + 280, y + 6, { width: 42, align: 'right' });
    doc.text(`$${Number(item.unit_price || 0).toFixed(2)}`, tableX + 350, y + 6, { width: 56, align: 'right' });
    doc.fillColor(ink).fontSize(10).text(`$${Number(item.amount || 0).toFixed(2)}`, tableX + 424, y + 6, { width: 58, align: 'right' });
    y += rowH;
  });

  const totalsX = 338;
  const totalsY = Math.min(y + 20, 610);
  doc.roundedRect(totalsX, totalsY, 210, 118, 10).fill(panel).strokeColor(line).stroke();
  doc.fillColor(muted).fontSize(9).text('Subtotal', totalsX + 18, totalsY + 14);
  doc.fillColor(ink).text(`$${subtotal.toFixed(2)}`, totalsX + 120, totalsY + 14, { width: 70, align: 'right' });
  doc.fillColor(muted).text(`GST (${gstRate}%)`, totalsX + 18, totalsY + 34);
  doc.fillColor(ink).text(`$${gst.toFixed(2)}`, totalsX + 120, totalsY + 34, { width: 70, align: 'right' });
  doc.fillColor(muted).text('Total', totalsX + 18, totalsY + 54);
  doc.fillColor(ink).text(`$${total.toFixed(2)}`, totalsX + 120, totalsY + 54, { width: 70, align: 'right' });
  doc.fillColor(muted).text('Paid', totalsX + 18, totalsY + 74);
  doc.fillColor(ink).text(`$${paidAmount.toFixed(2)}`, totalsX + 120, totalsY + 74, { width: 70, align: 'right' });
  doc.roundedRect(totalsX, totalsY + 92, 210, 42, 8).fill(navy);
  doc.fillColor('#ffffff').fontSize(11).text('BALANCE DUE', totalsX + 18, totalsY + 106);
  doc.fontSize(14).text(`$${balanceDue.toFixed(2)}`, totalsX + 108, totalsY + 104, { width: 82, align: 'right' });

  const payY = 642;
  doc.fillColor(accentDark).fontSize(11).text('Payment details', 48, payY);
  doc.fillColor(muted).fontSize(9);
  doc.text('Bank: Commonwealth Bank', 48, payY + 22);
  doc.text('Account name: Voxel Veda Pty Ltd', 48, payY + 38);
  doc.text('BSB / Account: Add your details', 48, payY + 54);
  doc.text(`Reference: ${invoice.invoice_no || `INV-${id}`}`, 48, payY + 70);

  const privacyY = 724;
  doc.roundedRect(48, privacyY, 500, 76, 8).fill('#f8fafc').strokeColor(line).stroke();
  doc.fillColor(accentDark).fontSize(8.6).text('Privacy, confidentiality & document handling', 62, privacyY + 10);
  doc.fillColor(muted).fontSize(7.5).text(
    'This invoice may contain confidential customer, supplier, pricing, production or payment information. Scan the QR code to view the live Voxel Veda privacy policy.',
    62,
    privacyY + 24,
    { width: 350, lineGap: 1 }
  );
  doc.fillColor(accentDark).fontSize(7).text(privacyPolicyUrl.replace(/^https?:\/\//, ''), 62, privacyY + 56, { width: 350 });
  drawScanSafeQr(doc, privacyQrPath, privacyPolicyUrl, 474, privacyY + 12, 58);

  doc.fillColor(ink).fontSize(10).text('Thank you for your business.', 48, 812);
  doc.fillColor(muted).fontSize(8).text('Electronically generated by Voxel Veda. Please use the invoice number as payment reference.', 48, 826, { width: 360 });
  doc.fillColor(ink).fontSize(9).text('Authorized Signatory', 416, 812);
  doc.fillColor(muted).fontSize(8).text('Voxel Veda Pty Ltd', 416, 828);
}
