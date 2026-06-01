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
      SELECT *
      FROM invoices
      WHERE deleted = 0 OR deleted IS NULL
      ORDER BY id ASC
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

    const [[invoice]] = await pool.query(
      'SELECT * FROM invoices WHERE id = ? AND (deleted = 0 OR deleted IS NULL) LIMIT 1',
      [id]
    );

    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    const [items] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
      [id]
    );

    res.json({ invoice, items });
  } catch (err) {
    console.error('GET INVOICE DETAILS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load invoice details', error: err.message });
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
    const { invoice_id } = req.body;

    if (!invoice_id) return res.status(400).json({ message: 'Invoice ID required' });

    const [result] = await pool.query(
      "UPDATE invoices SET status = 'paid' WHERE id = ?",
      [invoice_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Invoice not found' });

    await logInvoiceActivity(invoice_id, 'paid', 'Invoice marked as paid');

    res.json({ message: 'Invoice marked as paid' });
  } catch (err) {
    console.error('MARK INVOICE PAID ERROR FULL:', err);
    res.status(500).json({ message: 'Invoice paid update failed', error: err.message });
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
    const { id } = req.params;

    const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ? LIMIT 1', [id]);

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
  const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id = ? LIMIT 1', [id]);

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

function createInvoicePdfDocument(invoice, items, id) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  renderInvoicePdf(doc, invoice, items, id);
  return doc;
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
  doc.roundedRect(totalsX, totalsY, 210, 110, 10).fill(panel).strokeColor(line).stroke();
  doc.fillColor(muted).fontSize(10).text('Subtotal', totalsX + 18, totalsY + 18);
  doc.fillColor(ink).text(`$${subtotal.toFixed(2)}`, totalsX + 120, totalsY + 18, { width: 70, align: 'right' });
  doc.fillColor(muted).text(`GST (${gstRate}%)`, totalsX + 18, totalsY + 43);
  doc.fillColor(ink).text(`$${gst.toFixed(2)}`, totalsX + 120, totalsY + 43, { width: 70, align: 'right' });
  doc.roundedRect(totalsX, totalsY + 68, 210, 42, 8).fill(navy);
  doc.fillColor('#ffffff').fontSize(12).text('TOTAL AUD', totalsX + 18, totalsY + 82);
  doc.fontSize(15).text(`$${total.toFixed(2)}`, totalsX + 108, totalsY + 80, { width: 82, align: 'right' });

  const payY = 642;
  doc.fillColor(accentDark).fontSize(11).text('Payment details', 48, payY);
  doc.fillColor(muted).fontSize(9);
  doc.text('Bank: Commonwealth Bank', 48, payY + 22);
  doc.text('Account name: Voxel Veda Pty Ltd', 48, payY + 38);
  doc.text('BSB / Account: Add your details', 48, payY + 54);
  doc.text(`Reference: ${invoice.invoice_no || `INV-${id}`}`, 48, payY + 70);

  const privacyY = 744;
  doc.roundedRect(48, privacyY, 500, 54, 8).fill('#f8fafc').strokeColor(line).stroke();
  doc.fillColor(accentDark).fontSize(8.6).text('Privacy, confidentiality & document handling', 62, privacyY + 10);
  doc.fillColor(muted).fontSize(7.5).text(
    'This invoice may contain confidential customer, supplier, pricing, production or payment information. Scan the QR code to view the live Voxel Veda privacy policy.',
    62,
    privacyY + 24,
    { width: 380, lineGap: 1 }
  );
  if (fs.existsSync(privacyQrPath)) {
    doc.image(privacyQrPath, 492, privacyY + 8, { width: 38 });
    doc.link(492, privacyY + 8, 38, 38, privacyPolicyUrl);
  }

  doc.fillColor(ink).fontSize(10).text('Thank you for your business.', 48, 812);
  doc.fillColor(muted).fontSize(8).text('Electronically generated by Voxel Veda. Please use the invoice number as payment reference.', 48, 826, { width: 360 });
  doc.fillColor(ink).fontSize(9).text('Authorized Signatory', 416, 812);
  doc.fillColor(muted).fontSize(8).text('Voxel Veda Pty Ltd', 416, 828);
}
