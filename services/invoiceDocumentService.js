'use strict';
const { money, dateLabel, pdfError } = require('./documentPdfService');
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function invoiceDocumentData(invoice, items = []) {
  const rows = items.length ? items : [{ description: invoice.description, quantity: invoice.quantity, unit_price: invoice.unit_price, amount: Number(invoice.quantity) * Number(invoice.unit_price) }];
  const rate = Number(invoice.gst_rate ?? 10);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw pdfError('The invoice GST rate is invalid.', 'PDF_DATA_INVALID');
  const subtotal = round(rows.reduce((sum, row) => sum + Number(row.total ?? row.amount ?? (Number(row.qty ?? row.quantity) * Number(row.unit_price))), 0));
  const gst = round(subtotal * rate / 100);
  const total = round(invoice.total);
  if (!Number.isFinite(total) || Math.abs(total - round(subtotal + gst)) > 0.02) throw pdfError('Invoice item totals do not match the saved invoice total. Review the invoice before downloading or emailing.', 'PDF_TOTAL_MISMATCH');
  const reference = invoice.invoice_no || `INV-${invoice.id}`;
  return {
    sourceVersion: Number(invoice.document_revision || 1),
    customerEmail: String(invoice.customer_email || '').trim().toLowerCase(),
    title: ['draft','rejected'].includes(String(invoice.status).toLowerCase()) ? 'DRAFT INVOICE' : 'INVOICE', reference, filename: reference,
    issueDate: invoice.created_at, party: [invoice.customer_name, invoice.customer_email].filter(Boolean).join(' | '),
    columns: [{ label: 'Description', width: 4 }, { label: 'Quantity', width: 1, align: 'right' }, { label: 'Unit price', width: 1.6, align: 'right' }, { label: 'Amount', width: 1.6, align: 'right' }],
    rows: rows.map(row => [row.description || row.product_name || 'Item', String(Number(row.qty ?? row.quantity ?? 1)), money(row.unit_price), money(row.total ?? row.amount ?? (Number(row.qty ?? row.quantity) * Number(row.unit_price)))]),
    totals: [{ label: 'Subtotal', value: money(subtotal) }, { label: `GST (${rate}%)`, value: money(gst) }, { label: 'Invoice total', value: money(total) }, { label: 'Payments recorded', value: money(invoice.paid_amount || 0) }, { label: 'Balance due', value: money(invoice.balance_due ?? Math.max(total - Number(invoice.paid_amount || 0), 0)) }],
    notes: [invoice.rfq_id ? `RFQ reference: RFQ-${invoice.rfq_id}` : '', 'Currency: AUD. Please use the invoice number when contacting Voxel Veda about payment.', invoice.notes || ''].filter(Boolean)
  };
}
function statementDocumentData(statement) {
  return { customerEmail: String(statement.customer.email || '').trim().toLowerCase(), title: 'CUSTOMER STATEMENT', reference: 'Invoice and payment history', filename: `${statement.customer.name}-statement`, issueDate: statement.issueDate || new Date().toISOString(), party: [statement.customer.name, statement.customer.email].filter(Boolean).join(' | '),
    tables: [
      { title: 'Invoice history', columns: [{ label: 'Date', width: 1.4 }, { label: 'Invoice', width: 1.5 }, { label: 'Status', width: 1 }, { label: 'Total', width: 1.5, align: 'right' }, { label: 'Paid', width: 1.5, align: 'right' }, { label: 'Balance', width: 1.5, align: 'right' }], rows: statement.invoices.map(row => [dateLabel(row.created_at), row.invoice_no || `INV-${row.id}`, row.status, money(row.total), money(row.paid_amount), money(row.balance_due)]) },
      { title: 'Recorded invoice payments', columns: [{ label: 'Date', width: 1.4 }, { label: 'Invoice', width: 1.5 }, { label: 'Method', width: 1.3 }, { label: 'Reference', width: 2 }, { label: 'Amount', width: 1.5, align: 'right' }], rows: statement.payments.map(row => [dateLabel(row.payment_date), row.invoice_no || `INV-${row.invoice_id}`, row.method || '', row.reference || '', money(row.amount)]) }
    ], totals: [{ label: 'Invoice value', value: money(statement.totals.invoice_value) }, { label: 'Recorded payments', value: money(statement.totals.paid) }, { label: 'Balance due', value: money(statement.totals.balance_due) }], notes: ['This statement reflects recorded invoices and their payments. Contact Voxel Veda for questions or corrections.'] };
}
function blankInvoiceDocumentData() {
  return { title: 'BLANK INVOICE', reference: 'Invoice template', filename: 'voxel-veda-blank-invoice', party: 'Customer: __________________________________________', columns: [{ label: 'Description', width: 4 }, { label: 'Quantity', width: 1 }, { label: 'Unit price', width: 1.5 }, { label: 'Amount', width: 1.5 }], rows: Array.from({ length: 10 }, () => ['____________________________________', '_______', '_________', '_________']), notes: ['Invoice number: ____________________  Issue date: ____________________', 'Subtotal: ____________________  GST: ____________________  Total: ____________________', 'Terms / notes: ___________________________________________________________'] };
}
module.exports = { invoiceDocumentData, statementDocumentData, blankInvoiceDocumentData };
