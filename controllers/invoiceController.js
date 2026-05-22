const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

async function ensureInvoiceColumns() {
  await pool.query(`ALTER TABLE invoices ADD COLUMN description TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 1`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN gst_rate DECIMAL(5,2) NOT NULL DEFAULT 10`).catch(() => {});
  await pool.query(`ALTER TABLE invoices ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
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

    const doc = new PDFDocument({ size: 'A4', margin: 0 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_no || 'invoice'}.pdf"`);

    doc.pipe(res);

    const W = doc.page.width;
    const H = doc.page.height;

    const blue = '#0057C2';
    const darkBlue = '#06224A';
    const lightBlue = '#EAF3FF';
    const text = '#111827';
    const line = '#D9E2EF';

    const gstRate = Number(invoice.gst_rate || 10);
    const subtotal = invoiceItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const gst = subtotal * (gstRate / 100);
    const total = subtotal + gst;

    const invoiceDate = invoice.created_at
      ? new Date(invoice.created_at).toLocaleDateString('en-AU')
      : new Date().toLocaleDateString('en-AU');

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    doc.rect(0, 0, W, H).fill('#F8FBFF');

    doc.moveTo(W - 90, 0).lineTo(W, 90).strokeColor('#D7E8FA').lineWidth(2).stroke();
    doc.moveTo(W - 65, 0).lineTo(W, 65).strokeColor('#EEF5FF').lineWidth(2).stroke();

    doc.polygon([0, H - 170], [0, H], [120, H], [0, H - 90]).fill(darkBlue);
    doc.polygon([0, H - 135], [0, H], [85, H], [0, H - 75]).fill(blue);
    doc.polygon([0, H - 105], [0, H], [55, H], [0, H - 55]).fill('#111827');

    const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png');

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 45, 38, { width: 130 });
      } catch {
        doc.fillColor(darkBlue).fontSize(26).text('VOXEL', 45, 45);
        doc.fillColor(blue).text('VEDA', 45, 75);
      }
    } else {
      doc.fillColor(darkBlue).fontSize(26).text('VOXEL', 45, 45);
      doc.fillColor(blue).text('VEDA', 45, 75);
    }

    doc.fillColor(text).fontSize(34).text('INVOICE', 405, 75, {
      width: 140,
      align: 'center'
    });

    doc.moveTo(445, 125).lineTo(525, 125).strokeColor(blue).lineWidth(3).stroke();

    doc.roundedRect(45, 175, 38, 38, 6).fill(blue);
    doc.fillColor('#FFFFFF').fontSize(14).text('B', 58, 187);

    doc.fillColor(blue).fontSize(12).text('BILL TO:', 95, 178);
    doc.fillColor(text).fontSize(11);
    doc.text(invoice.customer_name || 'Client Name Pty. Ltd.', 95, 203);
    doc.text(invoice.customer_email || 'client@example.com', 95, 222);
    doc.text('Australia', 95, 241);

    doc.roundedRect(330, 175, 38, 38, 6).fill(blue);
    doc.fillColor('#FFFFFF').fontSize(14).text('I', 344, 187);

    const infoX = 385;
    doc.fillColor(text).fontSize(10);
    doc.text('Invoice No', infoX, 178);
    doc.text(':', infoX + 95, 178);
    doc.text(invoice.invoice_no || `INV-${id}`, infoX + 110, 178);

    doc.text('Invoice Date', infoX, 200);
    doc.text(':', infoX + 95, 200);
    doc.text(invoiceDate, infoX + 110, 200);

    doc.text('Due Date', infoX, 222);
    doc.text(':', infoX + 95, 222);
    doc.text(dueDate.toLocaleDateString('en-AU'), infoX + 110, 222);

    doc.text('RFQ ID', infoX, 244);
    doc.text(':', infoX + 95, 244);
    doc.text(invoice.rfq_id || 'Manual Invoice', infoX + 110, 244);

    doc.text('Status', infoX, 266);
    doc.text(':', infoX + 95, 266);
    doc.text(invoice.status || 'draft', infoX + 110, 266);

    const tableX = 45;
    const tableY = 320;
    const tableW = 505;
    const headerH = 42;
    const rowH = 48;

    doc.rect(tableX, tableY, tableW, headerH).fill(blue);

    doc.fillColor('#FFFFFF').fontSize(10);
    doc.text('DESCRIPTION', tableX + 20, tableY + 15);
    doc.text('QTY', tableX + 260, tableY + 15);
    doc.text('UNIT PRICE (AUD)', tableX + 330, tableY + 15);
    doc.text('AMOUNT (AUD)', tableX + 430, tableY + 15);

    invoiceItems.slice(0, 6).forEach((item, index) => {
      const rowY = tableY + headerH + index * rowH;

      doc.rect(tableX, rowY, tableW, rowH).fill('#FFFFFF');
      doc.rect(tableX, rowY, tableW, rowH).strokeColor(line).stroke();

      doc.roundedRect(tableX + 12, rowY + 9, 30, 30, 6).fill(lightBlue);
      doc.fillColor(blue).fontSize(9).text(String(index + 1), tableX + 24, rowY + 18);

      doc.fillColor(text).fontSize(9);
      doc.text(item.description || 'Item', tableX + 55, rowY + 16, { width: 185 });
      doc.text(String(Number(item.quantity || 0)), tableX + 267, rowY + 16);
      doc.text(`$${Number(item.unit_price || 0).toFixed(2)}`, tableX + 335, rowY + 16);
      doc.text(`$${Number(item.amount || 0).toFixed(2)}`, tableX + 435, rowY + 16);
    });

    const totalX = 340;
    const totalY = tableY + headerH + invoiceItems.slice(0, 6).length * rowH + 28;

    doc.rect(totalX, totalY, 210, 36).fill('#FFFFFF').strokeColor(line).stroke();
    doc.fillColor(text).fontSize(10).text('SUBTOTAL', totalX + 20, totalY + 13);
    doc.text(`$${subtotal.toFixed(2)}`, totalX + 125, totalY + 13);

    doc.rect(totalX, totalY + 36, 210, 36).fill('#FFFFFF').strokeColor(line).stroke();
    doc.text(`GST (${gstRate}%)`, totalX + 20, totalY + 49);
    doc.text(`$${gst.toFixed(2)}`, totalX + 125, totalY + 49);

    doc.rect(totalX, totalY + 72, 210, 42).fill(blue);
    doc.fillColor('#FFFFFF').fontSize(14).text('TOTAL', totalX + 20, totalY + 86);
    doc.text(`$${total.toFixed(2)}`, totalX + 115, totalY + 86);

    doc.roundedRect(65, 610, 28, 28, 5).fill(blue);
    doc.fillColor('#FFFFFF').fontSize(14).text('$', 75, 616);

    doc.fillColor(blue).fontSize(11).text('Payment Information', 105, 613);
    doc.fillColor(text).fontSize(9);
    doc.text('Bank Name        : Commonwealth Bank', 105, 635);
    doc.text('Account Name     : Voxel Veda Pty Ltd', 105, 651);
    doc.text('BSB / Account    : Add your details', 105, 667);
    doc.text('Reference        : ' + (invoice.invoice_no || `INV-${id}`), 105, 683);

    doc.fillColor(blue).fontSize(12).text('Thank you for your business!', 105, 730);
    doc.fillColor(text).fontSize(9);
    doc.text('For any queries, contact us at', 105, 753);
    doc.text('info@voxelveda.com | www.voxelveda.com', 105, 770);

    doc.moveTo(350, 720).lineTo(350, 790).strokeColor('#9CA3AF').lineWidth(1).stroke();

    doc.fillColor(text).fontSize(10).text('Authorized Signatory', 405, 750);
    doc.fontSize(9).text('Voxel Veda Pty Ltd', 405, 767);

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
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
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

  const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png');
  const teal = '#2dd4bf';
  const blue = '#38bdf8';
  const dark = '#0f172a';

  doc.rect(0, 0, doc.page.width, 96).fill(dark);

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 28, { width: 82 });
    } catch {
      doc.fillColor('#ffffff').fontSize(18).text('VOXEL VEDA', 50, 35);
    }
  } else {
    doc.fillColor('#ffffff').fontSize(18).text('VOXEL VEDA', 50, 35);
  }

  doc.fillColor(teal).fontSize(26).text('INVOICE', 395, 34, { width: 150, align: 'right' });
  doc.fillColor('#111827');
  doc.fontSize(11).text(`Invoice No: ${invoice.invoice_no || `INV-${id}`}`, 50, 130);
  doc.text(`Date: ${invoiceDate}`, 50, 148);
  doc.text(`Status: ${invoice.status || 'draft'}`, 50, 166);
  doc.text(`RFQ: ${invoice.rfq_id || 'Manual'}`, 50, 184);

  doc.fontSize(13).fillColor(blue).text('Bill To', 350, 130);
  doc.fillColor('#111827').fontSize(11);
  doc.text(invoice.customer_name || 'Customer', 350, 152);
  doc.text(invoice.customer_email || '-', 350, 170);

  const tableY = 245;
  doc.roundedRect(50, tableY, 495, 34, 6).fill(dark);
  doc.fillColor('#ffffff').fontSize(10);
  doc.text('Description', 65, tableY + 12);
  doc.text('Qty', 300, tableY + 12);
  doc.text('Unit', 365, tableY + 12);
  doc.text('Amount', 455, tableY + 12);

  let y = tableY + 44;
  invoiceItems.slice(0, 12).forEach((item, index) => {
    doc.fillColor(index % 2 === 0 ? '#f8fafc' : '#eef6ff').rect(50, y - 8, 495, 34).fill();
    doc.fillColor('#111827').fontSize(10);
    doc.text(item.description || 'Item', 65, y, { width: 220 });
    doc.text(String(Number(item.quantity || 0)), 300, y);
    doc.text(`$${Number(item.unit_price || 0).toFixed(2)}`, 365, y);
    doc.text(`$${Number(item.amount || 0).toFixed(2)}`, 455, y);
    y += 34;
  });

  y += 20;
  doc.fillColor('#111827').fontSize(11);
  doc.text('Subtotal', 365, y);
  doc.text(`$${subtotal.toFixed(2)}`, 455, y);
  y += 24;
  doc.text(`GST (${gstRate}%)`, 365, y);
  doc.text(`$${gst.toFixed(2)}`, 455, y);
  y += 28;
  doc.roundedRect(350, y - 10, 195, 38, 6).fill(teal);
  doc.fillColor('#07111f').fontSize(14).text('Total', 365, y);
  doc.text(`$${total.toFixed(2)}`, 455, y);

  doc.fillColor('#111827').fontSize(10).text('Thank you for your business.', 50, 720);
  doc.fillColor('#64748b').fontSize(9).text('Voxel Veda Pty Ltd | Advanced manufacturing and engineering operations', 50, 740);
}
