const pool = require('../config/db');
const { sendMail, missingSmtpKeys } = require('../services/emailService');

function clean(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function escapeHtml(value) {
  return clean(value, 2000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value) {
  return `
    <tr>
      <th style="text-align:left;padding:10px 12px;background:#eaf8ff;border:1px solid #bfefff;width:180px;">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;border:1px solid #bfefff;white-space:pre-line;">${escapeHtml(value) || '-'}</td>
    </tr>`;
}

async function saveLeadAsRFQ({ name, email, phone, company, need, source, page }) {
  const application = [
    `AI lead source: ${source}`,
    company ? `Company: ${company}` : '',
    `Need: ${need}`,
    page ? `Page: ${page}` : ''
  ].filter(Boolean).join('\n');

  const [result] = await pool.query(
    `
    INSERT INTO rfqs
    (customer_name, email, phone, material, quantity, application, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      company ? `${name} - ${company}` : name,
      email,
      phone,
      'AI assistant lead',
      1,
      application,
      'pending'
    ]
  );

  return result.insertId;
}

exports.createLead = async (req, res) => {
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 180);
  const phone = clean(req.body.phone, 80);
  const company = clean(req.body.company, 160);
  const need = clean(req.body.need, 1500);
  const source = clean(req.body.source, 120) || 'Voxel Veda AI';
  const page = clean(req.body.page, 300);
  const transcript = Array.isArray(req.body.transcript)
    ? req.body.transcript.map((item) => clean(item, 600)).filter(Boolean).slice(-12)
    : [];

  if (!name || !email || !need) {
    return res.status(400).json({ message: 'Name, email, and project need are required.' });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ message: 'A valid email address is required.' });
  }

  try {
    const rfqId = await saveLeadAsRFQ({ name, email, phone, company, need, source, page });
    const submittedAt = new Date().toISOString();
    const html = `
      <div style="font-family:Arial,sans-serif;color:#061b2d;line-height:1.5;">
        <h2 style="margin:0 0 12px;color:#061b2d;">New Voxel Veda AI Lead</h2>
        <p style="margin:0 0 16px;color:#345;">A visitor submitted their details through the Voxel Veda AI assistant.</p>
        <table style="border-collapse:collapse;width:100%;max-width:760px;font-size:14px;">
          ${row('RFQ App ID', rfqId)}
          ${row('Submitted At', submittedAt)}
          ${row('Source', source)}
          ${row('Name', name)}
          ${row('Email', email)}
          ${row('Phone', phone)}
          ${row('Company', company)}
          ${row('What They Need', need)}
          ${row('Page', page)}
          ${row('AI Conversation', transcript.join('\n'))}
        </table>
      </div>`;

    const text = [
      'New Voxel Veda AI Lead',
      `RFQ App ID: ${rfqId}`,
      `Submitted At: ${submittedAt}`,
      `Source: ${source}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Company: ${company}`,
      `What They Need: ${need}`,
      `Page: ${page}`,
      `AI Conversation: ${transcript.join(' | ')}`
    ].join('\n');

    try {
      await sendMail({
        to: 'voxelveda1@gmail.com',
        subject: `Voxel Veda AI Lead - ${name}`,
        html,
        text,
        replyTo: email
      });

      return res.json({ message: 'Lead saved and emailed successfully.', rfq_id: rfqId, email_sent: true });
    } catch (mailErr) {
      console.error('AI LEAD EMAIL ERROR:', mailErr);
      return res.json({
        message: 'Lead saved in the Voxel Veda app. Email notification is not available yet.',
        rfq_id: rfqId,
        email_sent: false,
        missing_smtp: missingSmtpKeys()
      });
    }
  } catch (err) {
    console.error('AI LEAD SAVE ERROR:', err);
    return res.status(500).json({ message: 'Lead save failed.' });
  }
};
