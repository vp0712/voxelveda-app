function buildInvoiceHtml({ company, customer, invoice, items, terms }) {
  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td>${item.description}</td>
        <td>${item.qty}</td>
        <td>AUD ${Number(item.unit_price).toFixed(2)}</td>
        <td>AUD ${Number(item.line_total).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const termsRows = terms.map((t) => `<li>${t}</li>`).join('');

  return `
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Arial, sans-serif; background:#f4f6f8; margin:0; padding:20px; color:#111; }
        .wrap { max-width:900px; margin:auto; background:#fff; padding:30px; border:1px solid #d9e1e7; border-radius:14px; }
        .head { display:flex; justify-content:space-between; gap:20px; border-bottom:2px solid #0ea5d3; padding-bottom:18px; margin-bottom:22px; }
        .left h2 { margin:0 0 8px; }
        .left p, .right p { margin:4px 0; color:#555; line-height:1.5; }
        .right { text-align:right; }
        h3 { margin:24px 0 12px; color:#0c4a6e; }
        table { width:100%; border-collapse:collapse; }
        th, td { border:1px solid #d9e1e7; padding:10px; text-align:left; vertical-align:top; }
        th { background:#f2f7fb; }
        .total { font-size:18px; font-weight:700; color:#0c4a6e; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="head">
          <div class="left">
            <h2>${company.name}</h2>
            <p>${company.address}</p>
            <p>Email: ${company.email}</p>
            <p>Phone: ${company.phone}</p>
            <p>ABN: ${company.abn}</p>
          </div>
          <div class="right">
            <h2>QUOTE / INVOICE</h2>
            <p><strong>Invoice No:</strong> ${invoice.invoice_no}</p>
            <p><strong>RFQ Ref:</strong> ${invoice.rfq_ref}</p>
            <p><strong>Date:</strong> ${invoice.date}</p>
          </div>
        </div>

        <h3>Customer Details</h3>
        <table>
          <tr><th>Full Name</th><td>${customer.full_name}</td></tr>
          <tr><th>Company Name</th><td>${customer.company_name || ''}</td></tr>
          <tr><th>Email</th><td>${customer.email}</td></tr>
          <tr><th>Phone</th><td>${customer.phone || ''}</td></tr>
        </table>

        <h3>Items</h3>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
            <tr>
              <td colspan="3" class="total">Approved Price</td>
              <td class="total">AUD ${Number(invoice.total).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <h3>Terms & Conditions</h3>
        <ul>${termsRows}</ul>

        <p style="margin-top:24px;">
          Regards,<br>
          <strong>${company.name}</strong><br>
          ${company.email}
        </p>
      </div>
    </body>
  </html>`;
}

module.exports = { buildInvoiceHtml };