const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { logAudit } = require('../utils/auditHelper');
const { calculatePrice } = require('../utils/pricingHelper');

const INVOICE_FLOW = {
  Draft: ['Approved', 'Cancelled'],
  Approved: ['Sent'],
  Sent: ['Paid'],
  Paid: [],
  Cancelled: []
};

function canTransition(current, next) {
  return (INVOICE_FLOW[current] || []).includes(next);
}

function buildInvoiceNo(id) {
  return `INV-${String(id).padStart(5, '0')}`;
}

exports.createInvoice = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { rfq_id } = req.body;

    // 🔒 Prevent duplicate invoices for same RFQ
const [existing] = await pool.query(
  'SELECT id FROM invoices WHERE rfq_id = ?',
  [rfq_id]
);

if (existing.length) {
  return res.status(400).json({
    message: 'Invoice already exists for this RFQ'
  });
}

    if (!rfq_id) {
      conn.release();
      return res.status(400).json({ message: 'rfq_id is required' });
    }

    await conn.beginTransaction();

    const [rfqRows] = await conn.query(
      'SELECT * FROM rfqs WHERE id = ? LIMIT 1',
      [rfq_id]
    );

    if (!rfqRows.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'RFQ not found' });
    }

    const rfq = rfqRows[0];

    if (rfq.status !== 'Approved') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        message: 'RFQ must be approved before creating invoice'
      });
    }

    const [existingInvoice] = await conn.query(
      'SELECT * FROM invoices WHERE rfq_id = ? LIMIT 1',
      [rfq_id]
    );

    if (existingInvoice.length) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        message: 'Invoice already exists for this RFQ'
      });
    }

    const pricing = await calculatePrice(rfq);

    const [insertInvoice] = await conn.query(
      `INSERT INTO invoices (invoice_no, rfq_id, subtotal, gst, total, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['', rfq_id, pricing.subtotal, pricing.gst, pricing.total, 'Draft']
    );

    const invoiceId = insertInvoice.insertId;
    const invoiceNo = buildInvoiceNo(invoiceId);

    await conn.query(
      'UPDATE invoices SET invoice_no = ? WHERE id = ?',
      [invoiceNo, invoiceId]
    );

    await conn.query(
      `INSERT INTO invoice_items (invoice_id, product_name, qty, unit_price, total)
       VALUES (?, ?, ?, ?, ?)`,
      [
        invoiceId,
        rfq.material || 'Custom Item',
        pricing.qty,
        pricing.unitPrice,
        pricing.subtotal
      ]
    );

    await conn.query(
      'UPDATE rfqs SET status = ? WHERE id = ?',
      ['Quoted', rfq_id]
    );

    await conn.commit();
    conn.release();

    await logAudit({
      entity_type: 'invoice',
      entity_id: invoiceId,
      action: 'CREATED',
      new_status: 'Draft',
      user_id: req.user.id,
      meta: { invoice_no: invoiceNo, rfq_id }
    });

    await logAudit({
      entity_type: 'rfq',
      entity_id: rfq_id,
      action: 'QUOTED',
      old_status: 'Approved',
      new_status: 'Quoted',
      user_id: req.user.id
    });

    res.json({
      message: 'Invoice created from approved RFQ',
      invoice: {
        id: invoiceId,
        invoice_no: invoiceNo,
        rfq_id: Number(rfq_id),
        subtotal: pricing.subtotal,
        gst: pricing.gst,
        total: pricing.total,
        status: 'Draft'
      }
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    conn.release();

    console.error('createInvoice error:', error);
    res.status(500).json({
      message: 'Invoice creation failed',
      error: error.message
    });
  }
};

exports.getInvoices = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, r.full_name, r.company_name, r.email
       FROM invoices i
       LEFT JOIN rfqs r ON r.id = i.rfq_id
       ORDER BY i.id DESC`
    );

    res.json({ invoices: rows });
  } catch (error) {
    console.error('getInvoices error:', error);
    res.status(500).json({
      message: 'Get invoices failed',
      error: error.message
    });
  }
};

exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const [invoiceRows] = await pool.query(
      `SELECT i.*, r.full_name, r.company_name, r.email, r.phone, r.material, r.quantity, r.dimensions,
              r.application, r.tolerance_req, r.surface_finish, r.delivery_location
       FROM invoices i
       LEFT JOIN rfqs r ON r.id = i.rfq_id
       WHERE i.id = ?
       LIMIT 1`,
      [id]
    );

    if (!invoiceRows.length) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const [itemRows] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
      [id]
    );

    res.json({
      invoice: invoiceRows[0],
      items: itemRows
    });
  } catch (error) {
    console.error('getInvoiceById error:', error);
    res.status(500).json({
      message: 'Get invoice failed',
      error: error.message
    });
  }
};

exports.approveInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ message: 'invoice_id required' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM invoices WHERE id = ? LIMIT 1',
      [invoice_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = rows[0];

    if (!canTransition(invoice.status, 'Approved')) {
      return res.status(400).json({
        message: `Cannot approve invoice from status ${invoice.status}`
      });
    }

    await pool.query(
      'UPDATE invoices SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
      ['Approved', req.user.id, invoice_id]
    );

    await logAudit({
      entity_type: 'invoice',
      entity_id: invoice_id,
      action: 'APPROVED',
      old_status: invoice.status,
      new_status: 'Approved',
      user_id: req.user.id
    });

    res.json({ message: 'Invoice approved successfully' });
  } catch (error) {
    console.error('approveInvoice error:', error);
    res.status(500).json({
      message: 'Approve invoice failed',
      error: error.message
    });
  }
};

exports.sendInvoice = async (req, res) => {
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ message: 'invoice_id required' });
    }

    const [invoiceRows] = await pool.query(
      'SELECT * FROM invoices WHERE id = ? LIMIT 1',
      [invoice_id]
    );

    if (!invoiceRows.length) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoiceRows[0];

    if (!canTransition(invoice.status, 'Sent')) {
      return res.status(400).json({
        message: `Cannot send invoice from status ${invoice.status}`
      });
    }

    const [rfqRows] = await pool.query(
      'SELECT * FROM rfqs WHERE id = ? LIMIT 1',
      [invoice.rfq_id]
    );

    if (!rfqRows.length) {
      return res.status(404).json({ message: 'Related RFQ not found' });
    }

    const rfq = rfqRows[0];

    const [itemRows] = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
      [invoice_id]
    );

    const invoiceNo = invoice.invoice_no || buildInvoiceNo(invoice.id);
    const invoicesDir = path.join(__dirname, '../invoices');

    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    const filePath = path.join(invoicesDir, `${invoiceNo}.pdf`);
    const logoPath = path.join(__dirname, '../assets/logo.png');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(fs.createWriteStream(filePath));

    if (fs.existsSync(logoPath)) {
  try {
    doc.image(logoPath, 40, 35, { width: 90 });
  } catch (err) {
    console.error('Logo image load failed:', err.message);
  }
}

    doc.fontSize(20).font('Helvetica-Bold').text('VOXEL VEDA PTY LTD', 320, 40, { align: 'right' });
    doc.fontSize(10).font('Helvetica')
      .text('Melbourne, VIC, Australia', 320, 70, { align: 'right' })
      .text('Email: info@voxelveda.com', 320, 84, { align: 'right' })
      .text('Phone: +61 420 407 232', 320, 98, { align: 'right' })
      .text('ABN: 52 683 871 767', 320, 112, { align: 'right' });

    doc.moveTo(40, 145).lineTo(555, 145).stroke();

    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', 40, 160);

    doc.fontSize(10).font('Helvetica')
      .text(`Invoice No: ${invoiceNo}`, 40, 188)
      .text(`Invoice Date: ${new Date().toLocaleDateString('en-AU')}`, 40, 202)
      .text(`Status: ${invoice.status}`, 40, 216);

    doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 40, 255);

    doc.fontSize(10).font('Helvetica')
      .text(rfq.full_name || '', 40, 273)
      .text(rfq.company_name || '', 40, 287)
      .text(rfq.email || '', 40, 301)
      .text(rfq.phone || '', 40, 315)
      .text(rfq.delivery_location || '', 40, 329, { width: 220 });

    doc.fontSize(12).font('Helvetica-Bold').text('Project Details:', 320, 255);

    doc.fontSize(10).font('Helvetica')
      .text(`Material: ${rfq.material || ''}`, 320, 273)
      .text(`Quantity: ${rfq.quantity || ''}`, 320, 287)
      .text(`Dimensions: ${rfq.dimensions || ''}`, 320, 301)
      .text(`Tolerance: ${rfq.tolerance_req || ''}`, 320, 315)
      .text(`Finish: ${rfq.surface_finish || ''}`, 320, 329);

    let tableTop = 380;

    doc.rect(40, tableTop, 515, 22).fillAndStroke('#0f172a', '#0f172a');

    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
      .text('Description', 48, tableTop + 6)
      .text('Qty', 310, tableTop + 6)
      .text('Unit Price', 370, tableTop + 6)
      .text('Line Total', 460, tableTop + 6);

    let y = tableTop + 30;
    doc.fillColor('#000000').font('Helvetica');

    if (!itemRows.length) {
      doc.text('No items found', 48, y);
      y += 24;
    } else {
      itemRows.forEach((item) => {
        doc.fontSize(10)
          .text(item.product_name || '', 48, y, { width: 240 })
          .text(String(item.qty || ''), 310, y)
          .text(`$${Number(item.unit_price || 0).toFixed(2)}`, 370, y)
          .text(`$${Number(item.total || 0).toFixed(2)}`, 460, y);

        y += 24;
        doc.moveTo(40, y - 4).lineTo(555, y - 4).strokeColor('#dddddd').stroke();
      });
    }

    y += 15;
    doc.font('Helvetica').fontSize(10)
      .text('Subtotal:', 380, y)
      .text(`$${Number(invoice.subtotal || 0).toFixed(2)}`, 470, y);

    y += 18;
    doc.text('GST (10%):', 380, y)
      .text(`$${Number(invoice.gst || 0).toFixed(2)}`, 470, y);

    y += 20;
    doc.font('Helvetica-Bold').fontSize(12)
      .text('Total:', 380, y)
      .text(`$${Number(invoice.total || 0).toFixed(2)}`, 470, y);

    y += 45;
    doc.font('Helvetica-Bold').fontSize(12).text('Terms & Conditions', 40, y);

    y += 20;
    doc.font('Helvetica').fontSize(9)
      .text('1. This quotation/invoice is valid for 7 days from the issue date.', 40, y, { width: 515 });

    y += 14;
    doc.text('2. Manufacturing begins only after customer approval and payment confirmation where applicable.', 40, y, { width: 515 });

    y += 14;
    doc.text('3. Voxel Veda is not responsible for errors in customer-supplied drawings or files.', 40, y, { width: 515 });

    y += 14;
    doc.text('4. Delivery times are estimates and may vary depending on workload and production complexity.', 40, y, { width: 515 });

    y += 14;
    doc.text('5. Any changes to specifications may result in revised pricing and lead time.', 40, y, { width: 515 });

    y += 35;
    doc.font('Helvetica-Bold').fontSize(12).text('Payment Details', 40, y);

    y += 20;
    doc.font('Helvetica').fontSize(9)
      .text('Bank: Your Bank Name', 40, y)
      .text('Account Name: Voxel Veda Pty Ltd', 40, y + 14)
      .text('BSB: XXX-XXX', 40, y + 28)
      .text('Account Number: XXXXXX', 40, y + 42);

    doc.fontSize(9).fillColor('#555555')
      .text('Thank you for your business.', 40, 780, { align: 'center', width: 515 });

    doc.end();

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: {
        user: process.env.SMTP_USER || 'info@voxelveda.com',
        pass: process.env.SMTP_PASS || 'Viral@0712'
      }
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"Voxel Veda" <${process.env.SMTP_USER || 'info@voxelveda.com'}>`,
      to: rfq.email,
      subject: `Invoice ${invoiceNo}`,
      text: 'Please find your invoice attached.',
      attachments: [
        {
          filename: `${invoiceNo}.pdf`,
          path: filePath
        }
      ]
    });

    await pool.query(
      'UPDATE invoices SET status = ?, sent_at = NOW() WHERE id = ?',
      ['Sent', invoice_id]
    );

    await logAudit({
      entity_type: 'invoice',
      entity_id: invoice_id,
      action: 'SENT',
      old_status: invoice.status,
      new_status: 'Sent',
      user_id: req.user.id
    });

    res.json({
      message: 'Invoice PDF created and email sent',
      file: `${invoiceNo}.pdf`
    });
  } catch (error) {
    console.error('sendInvoice error:', error);
    res.status(500).json({
      message: 'PDF creation failed',
      error: error.message
    });
  }
};

exports.markInvoicePaid = async (req, res) => {
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ message: 'invoice_id required' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM invoices WHERE id = ? LIMIT 1',
      [invoice_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = rows[0];

    if (!canTransition(invoice.status, 'Paid')) {
      return res.status(400).json({
        message: `Cannot mark invoice paid from status ${invoice.status}`
      });
    }

    await pool.query(
      'UPDATE invoices SET status = ?, paid_at = NOW() WHERE id = ?',
      ['Paid', invoice_id]
    );

    await logAudit({
      entity_type: 'invoice',
      entity_id: invoice_id,
      action: 'PAID',
      old_status: invoice.status,
      new_status: 'Paid',
      user_id: req.user.id
    });

    res.json({ message: 'Invoice marked as paid' });
  } catch (error) {
    console.error('markInvoicePaid error:', error);
    res.status(500).json({
      message: 'Mark invoice paid failed',
      error: error.message
    });
  }
};