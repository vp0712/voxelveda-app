const pool = require('../config/db');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

exports.createInvoice = async (req, res) => {
  try {
    const { rfq_id } = req.body;

    const [[rfq]] = await pool.query('SELECT * FROM rfqs WHERE id=?', [rfq_id]);

    if (!rfq) return res.status(404).json({ message: 'RFQ not found' });
    if (rfq.status !== 'approved') return res.status(400).json({ message: 'RFQ must be approved first' });

    const invoiceNo = `INV-${Date.now()}`;
    const total = 100.00;

    const [result] = await pool.query(
      `INSERT INTO invoices (invoice_no, rfq_id, customer_email, total, status)
       VALUES (?, ?, ?, ?, 'draft')`,
      [invoiceNo, rfq_id, rfq.email, total]
    );

    await pool.query("UPDATE rfqs SET status='quoted' WHERE id=?", [rfq_id]);

    res.json({ message: 'Invoice created', invoice_id: result.insertId, invoice_no: invoiceNo });
  } catch (err) {
    res.status(500).json({ message: 'Invoice creation failed', error: err.message });
  }
};

exports.getInvoices = async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM invoices ORDER BY id DESC');
  res.json({ invoices: rows });
};

exports.viewInvoicePdf = async (req, res) => {
  const { id } = req.params;
  const [[invoice]] = await pool.query('SELECT * FROM invoices WHERE id=?', [id]);

  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_no}.pdf"`);

  doc.pipe(res);
  doc.fontSize(22).text('Voxel Veda Pty Ltd Invoice', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text(`Invoice No: ${invoice.invoice_no}`);
  doc.text(`RFQ ID: ${invoice.rfq_id}`);
  doc.text(`Customer Email: ${invoice.customer_email}`);
  doc.text(`Total: $${invoice.total}`);
  doc.text(`Status: ${invoice.status}`);
  doc.end();
};