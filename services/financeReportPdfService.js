'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

function clean(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function date(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '—';
  const bits = raw.split('-');
  return bits[2] + '/' + bits[1] + '/' + bits[0];
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function amount(value, currency) {
  const n = number(value);
  if (!(n > 0)) return '';
  return String(currency || 'AUD').toUpperCase() + ' ' + new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function signedAmount(value, currency) {
  const n = number(value);
  return String(currency || 'AUD').toUpperCase() + ' ' + new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function safeName(value) {
  return clean(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Finance-Report';
}

function drawHeader(doc, profile, title, reportId, generatedAt, pageNumber, pageCount) {
  const logoPath = path.join(__dirname, '..', 'public', 'Frame 1.png');
  if (fs.existsSync(logoPath)) {
    try { doc.image(logoPath, 42, 24, { fit: [52, 42] }); } catch {}
  }
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0F2744')
    .text(profile.tradingName || profile.legalName || 'Voxel Veda', 104, 27, { width: 260 });
  doc.font('Helvetica').fontSize(7).fillColor('#64748B')
    .text(profile.legalName || 'Voxel Veda Pty Ltd', 104, 43, { width: 260 });

  const identity = [
    profile.abn ? 'ABN ' + profile.abn : null,
    profile.website || null,
    profile.email || null
  ].filter(Boolean).join(' · ');
  doc.fontSize(6.8).fillColor('#64748B').text(identity, 104, 55, { width: 330 });

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#1D4ED8')
    .text('FINANCE REPORT', 385, 27, { width: 168, align: 'right' });
  doc.font('Helvetica').fontSize(6.8).fillColor('#64748B')
    .text('Page ' + pageNumber + ' of ' + pageCount, 420, 49, { width: 133, align: 'right' });

  doc.moveTo(42, 87).lineTo(553, 87).strokeColor('#D8E2EE').lineWidth(0.7).stroke();
  doc.fontSize(6.6).fillColor('#64748B')
    .text(title + ' · ' + reportId + ' · Generated ' + generatedAt.toLocaleString('en-AU'), 42, 95, { width: 511, align: 'right' });

  doc.moveTo(42, 774).lineTo(553, 774).strokeColor('#D8E2EE').lineWidth(0.6).stroke();
  doc.fontSize(6.8).fillColor('#64748B')
    .text((profile.footer || 'Confidential Financial Information') + ' · ' + (profile.website || '') + ' · Page ' + pageNumber + ' of ' + pageCount, 42, 782, { width: 510, align: 'center' });
}

function tableHeader(doc, y, columns) {
  let x = 42;
  const width = columns.reduce(function (sum, col) { return sum + col.width; }, 0);
  doc.rect(x, y, width, 24).fillAndStroke('#0F2744', '#0F2744');
  doc.font('Helvetica-Bold').fontSize(6.7).fillColor('#FFFFFF');
  columns.forEach(function (col) {
    doc.text(col.label, x + 4, y + 7, { width: col.width - 8, align: col.align || 'left' });
    x += col.width;
  });
  return y + 24;
}

function measuredRowHeight(doc, columns, values) {
  let height = 27;
  doc.font('Helvetica').fontSize(6.5);
  columns.forEach(function (col, index) {
    const text = clean(values[index]);
    const measured = doc.heightOfString(text, { width: col.width - 8, lineGap: 0.5 });
    height = Math.max(height, Math.min(45, measured + 9));
  });
  return height;
}

function tableRow(doc, y, columns, values, rowIndex) {
  const height = measuredRowHeight(doc, columns, values);
  let x = 42;
  const totalWidth = columns.reduce(function (sum, col) { return sum + col.width; }, 0);
  if (rowIndex % 2 === 1) doc.rect(42, y, totalWidth, height).fill('#F8FAFC');

  columns.forEach(function (col, index) {
    doc.rect(x, y, col.width, height).strokeColor('#D8E2EE').lineWidth(0.45).stroke();
    const isAmount = index >= columns.length - 2;
    doc.font(isAmount ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(6.4)
      .fillColor(isAmount ? '#0F2744' : '#24364B')
      .text(clean(values[index]), x + 4, y + 5, {
        width: col.width - 8,
        height: height - 8,
        align: col.align || 'left',
        ellipsis: true,
        lineGap: 0.5
      });
    x += col.width;
  });
  return y + height;
}

function ensureSpace(doc, y, needed, columns) {
  if (y + needed <= 742) return y;
  doc.addPage();
  return tableHeader(doc, 118, columns);
}

function renderSummary(doc, report, title) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0F2744').text(title, 42, 116, { width: 350 });
  doc.font('Helvetica').fontSize(7.4).fillColor('#64748B').text(
    'Workspace ' + report.metadata.scope + ' · ' + (report.metadata.from || 'All history') + ' to ' + (report.metadata.to || 'Now') +
    ' · ' + report.metadata.source_transaction_count + ' canonical transaction(s)',
    42, 141, { width: 511 }
  );
  doc.font('Helvetica').fontSize(6.6).fillColor('#64748B').text(
    'Currency treatment: native currencies remain separate; this report does not invent foreign-exchange conversion.',
    42, 152, { width: 511 }
  );

  let y = 171;
  const summaries = Array.isArray(report.summary_by_currency) ? report.summary_by_currency : [];
  doc.roundedRect(42, y, 511, Math.min(530,Math.max(82,45+summaries.length*14)), 9).fillAndStroke('#F4F8FC', '#D7E4F0');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F2744').text('Financial summary', 56, y + 12, { width: 150 });

  let lineY = y + 31;
  if (!summaries.length) {
    doc.font('Helvetica').fontSize(7.1).fillColor('#64748B').text('No financial activity for the selected filters.', 56, lineY, { width: 470 });
  }
  summaries.forEach(function (row) {
    if(lineY+28>738){doc.addPage();lineY=128;}
    doc.font('Helvetica-Bold').fontSize(7.1).fillColor('#1D4ED8').text(String(row.currency || 'AUD'), 56, lineY, { width: 38 });
    doc.font('Helvetica').fillColor('#334155').text(
      'Money in ' + signedAmount(row.money_in, row.currency) +
      '  ·  Money out ' + signedAmount(row.money_out, row.currency) +
      '  ·  Net ' + signedAmount(row.net_cash_flow, row.currency),
      98, lineY, { width: 440 }
    );
    lineY += 14;
  });

  if (report.account_statement) {
    const s = report.account_statement;
    doc.font('Helvetica').fontSize(6.8).fillColor('#475569').text(
      'Opening ' + signedAmount(s.opening_running_balance, s.currency) +
      ' · Closing ' + signedAmount(s.closing_running_balance, s.currency) +
      ' · Debits ' + signedAmount(s.total_debits, s.currency) +
      ' · Credits ' + signedAmount(s.total_credits, s.currency),
      56, y + 64, { width: 480 }
    );
  }
  return Math.max(270,lineY+30);
}


function sectionStart(doc, y, heading, note) {
  if (y + 58 > 742) {
    doc.addPage();
    y = 118;
  } else {
    y += 18;
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F2744').text(heading, 42, y, { width: 220 });
  if (note) {
    doc.font('Helvetica').fontSize(6.6).fillColor('#64748B')
      .text(note, 270, y + 1, { width: 283, align: 'right' });
  }
  return y + 19;
}

function renderSimpleTable(doc, y, columns, rows) {
  y = tableHeader(doc, y, columns);
  if (!rows.length) return tableRow(doc, y, columns, columns.map(function (_, index) { return index === 0 ? 'No data' : '—'; }), 0);
  rows.forEach(function (values, index) {
    y = ensureSpace(doc, y, measuredRowHeight(doc, columns, values), columns);
    y = tableRow(doc, y, columns, values, index);
  });
  return y;
}

function renderSpecializedSection(doc, report, y) {
  const type = String(report.metadata && report.metadata.report_type || '').toUpperCase();

  if (type === 'GST_SUMMARY') {
    y = sectionStart(
      doc, y, 'GST review summary',
      'Recorded GST is shown from stored split evidence only; this report does not infer tax treatment.'
    );
    const columns = [
      { label: 'Currency', width: 64 },
      { label: 'GST treatment', width: 170 },
      { label: 'Transactions', width: 82, align: 'right' },
      { label: 'Gross expense', width: 100, align: 'right' },
      { label: 'Recorded GST', width: 95, align: 'right' }
    ];
    const rows = (Array.isArray(report.gst_summary) ? report.gst_summary : []).map(function (row) {
      return [
        row.currency || 'AUD',
        row.gst_treatment || 'UNREVIEWED',
        row.transaction_count || 0,
        signedAmount(row.gross_expense, row.currency),
        signedAmount(row.recorded_split_gst, row.currency)
      ];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  if (type === 'RECONCILIATION') {
    y = sectionStart(
      doc, y, 'Reconciliation summary',
      'Counts reflect the reconciliation status stored on canonical ledger transactions in the selected report scope.'
    );
    const columns = [
      { label: 'Status', width: 330 },
      { label: 'Transactions', width: 181, align: 'right' }
    ];
    const rows = Object.entries(report.reconciliation_summary || {}).map(function (entry) {
      return [entry[0], entry[1]];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  if (type === 'DATA_QUALITY') {
    y = sectionStart(
      doc, y, 'Data quality summary',
      'These controls identify records that still need classification, ownership, reconciliation, receipt or review work.'
    );
    const columns = [
      { label: 'Metric', width: 330 },
      { label: 'Value', width: 181, align: 'right' }
    ];
    const labels = {
      source_transactions: 'Source transactions',
      unclassified: 'Unclassified transactions',
      ownership_unclassified: 'Ownership unclassified',
      unreconciled: 'Unreconciled transactions',
      missing_receipts: 'Missing receipts',
      unreviewed: 'Unreviewed transactions',
      coverage_status: 'History coverage status'
    };
    const rows = Object.entries(report.data_quality || {}).map(function (entry) {
      return [labels[entry[0]] || entry[0].replace(/_/g, ' '), entry[1]];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  if (type === 'REIMBURSEMENT') {
    y = sectionStart(
      doc, y, 'Reimbursement summary',
      'Requested, paid and remaining values are kept separate from the underlying expense transaction.'
    );
    const columns = [
      { label: 'Date', width: 52 },
      { label: 'Account / merchant', width: 137 },
      { label: 'Status', width: 63 },
      { label: 'Requested', width: 86, align: 'right' },
      { label: 'Paid', width: 82, align: 'right' },
      { label: 'Remaining', width: 91, align: 'right' }
    ];
    const rows = (Array.isArray(report.reimbursements) ? report.reimbursements : []).map(function (row) {
      const descriptor = [row.account_name, row.merchant_name || row.description].filter(Boolean).join(' · ');
      return [
        date(row.transaction_date),
        descriptor,
        row.status || '',
        signedAmount(row.requested_amount, row.currency),
        signedAmount(row.paid_amount, row.currency),
        signedAmount(row.remaining_amount, row.currency)
      ];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  if (['CASH_FLOW', 'INCOME_VS_EXPENSE', 'PERSONAL_MONTHLY_SUMMARY', 'COMPANY_MONTHLY_SUMMARY'].includes(type)) {
    y = sectionStart(
      doc, y, 'Monthly cash flow summary',
      'Money in, money out and net movement remain separated by native currency.'
    );
    const columns = [
      { label: 'Month', width: 70 },
      { label: 'Currency', width: 58 },
      { label: 'Transactions', width: 72, align: 'right' },
      { label: 'Money in', width: 104, align: 'right' },
      { label: 'Money out', width: 104, align: 'right' },
      { label: 'Net cash flow', width: 103, align: 'right' }
    ];
    const rows = (Array.isArray(report.monthly) ? report.monthly : []).map(function (row) {
      return [
        row.month || '',
        row.currency || 'AUD',
        row.transaction_count || 0,
        signedAmount(row.money_in, row.currency),
        signedAmount(row.money_out, row.currency),
        signedAmount(row.net_cash_flow, row.currency)
      ];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  if (type === 'MERCHANT') {
    y = sectionStart(doc, y, 'Merchant summary', 'Merchant totals remain separated by native currency.');
    const columns = [
      { label: 'Currency', width: 62 },
      { label: 'Merchant', width: 227 },
      { label: 'Transactions', width: 76, align: 'right' },
      { label: 'Spent', width: 73, align: 'right' },
      { label: 'Received', width: 73, align: 'right' }
    ];
    const rows = (Array.isArray(report.merchants) ? report.merchants : []).map(function (row) {
      return [
        row.currency || 'AUD',
        row.merchant || 'Unknown',
        row.transaction_count || 0,
        signedAmount(row.spent, row.currency),
        signedAmount(row.received, row.currency)
      ];
    });
    return renderSimpleTable(doc, y, columns, rows);
  }

  return y;
}

function renderCategoryTable(doc, report, y) {
  doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#0F2744').text('Category totals', 42, y, { width: 170 });
  doc.font('Helvetica').fontSize(6.6).fillColor('#64748B')
    .text('Each amount is allocated to its recorded category. Split children replace the parent allocation to prevent double counting.', 190, y + 1, { width: 363, align: 'right' });
  y += 19;

  const columns = [
    { label: 'Currency', width: 58 },
    { label: 'Category', width: 248 },
    { label: 'Transactions', width: 84, align: 'right' },
    { label: 'Amount', width: 121, align: 'right' }
  ];
  y = tableHeader(doc, y, columns);
  const rows = Array.isArray(report.categories) ? report.categories : [];
  if (!rows.length) return tableRow(doc, y, columns, ['—', 'No category activity', '0', '—'], 0);

  rows.forEach(function (row, index) {
    const values = [
      row.currency || 'AUD',
      row.category || 'Unclassified',
      row.source_transaction_count || 0,
      signedAmount(row.spent, row.currency)
    ];
    y = ensureSpace(doc, y, measuredRowHeight(doc, columns, values), columns);
    y = tableRow(doc, y, columns, values, index);
  });
  return y;
}

function renderTransactions(doc, report, y) {
  if (y + 58 > 742) { doc.addPage(); y = 118; }
  else y += 18;

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0F2744').text('Transaction register', 42, y, { width: 190 });
  doc.font('Helvetica').fontSize(6.6).fillColor('#64748B')
    .text('Description, source reference and category stay separate for audit readability.', 260, y + 1, { width: 293, align: 'right' });
  y += 19;

  const columns = [
    { label: 'Date', width: 52 },
    { label: 'Account', width: 66 },
    { label: 'Description', width: 122 },
    { label: 'Reference', width: 82 },
    { label: 'Category', width: 76 },
    { label: 'Debit', width: 56, align: 'right' },
    { label: 'Credit', width: 57, align: 'right' }
  ];
  y = tableHeader(doc, y, columns);

  const rows = Array.isArray(report.transactions) ? report.transactions : [];
  if (!rows.length) {
    tableRow(doc, y, columns, ['—', '—', 'No transactions for selected filters', '—', '—', '—', '—'], 0);
    return;
  }

  rows.forEach(function (row, index) {
    const values = [
      date(row.transaction_date),
      row.account_name || '',
      row.description || row.merchant_name || 'Transaction',
      row.reference || '',
      row.category || 'Unclassified',
      amount(row.debit, row.currency),
      amount(row.credit, row.currency)
    ];
    y = ensureSpace(doc, y, measuredRowHeight(doc, columns, values), columns);
    y = tableRow(doc, y, columns, values, index);
  });
}

function buildFinancePdfArtifact(report, profile, title) {
  const reportId = report.metadata.report_id || 'FIN-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const generatedAt = new Date(report.metadata.generated_at || Date.now());
  const filename = 'Voxel-Veda-' + safeName(title) + '.pdf';

  return new Promise(function (resolve, reject) {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 112, left: 42, right: 42, bottom: 66 },
      bufferPages: true,
      info: {
        Title: (profile.tradingName || profile.legalName || 'Voxel Veda') + ' - ' + title,
        Author: profile.legalName || 'Voxel Veda Pty Ltd',
        Subject: 'Finance report'
      }
    });

    let pageCount = 0;
    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('error', reject);
    doc.on('end', function () {
      resolve({ buffer: Buffer.concat(chunks), reportId: reportId, filename: filename, pages: pageCount });
    });

    try {
      let y = renderSummary(doc, report, title);
      y = renderSpecializedSection(doc, report, y);
      y = renderCategoryTable(doc, report, y);
      renderTransactions(doc, report, y);

      const pages = doc.bufferedPageRange();
      pageCount = pages.count;
      for (let index = 0; index < pages.count; index += 1) {
        doc.switchToPage(index);
        drawHeader(doc, profile, title, reportId, generatedAt, index + 1, pages.count);
      }
      doc.end();
    } catch (error) {
      try { doc.end(); } catch {}
      reject(error);
    }
  });
}

module.exports = { buildFinancePdfArtifact };
