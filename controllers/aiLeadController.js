const { sendMail } = require('../services/emailService');

function clean(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
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
      <td style="padding:10px 12px;border:1px solid #bfefff;">${escapeHtml(value) || '-'}</td>
    </tr>`;
}

exports.createLead = async (req, res) => {
  try {
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

    const submittedAt = new Date().toISOString();
    const html = `
      <div style="font-family:Arial,sans-serif;color:#061b2d;line-height:1.5;">
        <h2 style="margin:0 0 12px;color:#061b2d;">New Voxel Veda AI Lead</h2>
        <p style="margin:0 0 16px;color:#345;">A visitor submitted their details through the Voxel Veda AI assistant.</p>
        <table style="border-collapse:collapse;width:100%;max-width:760px;font-size:14px;">
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

    await sendMail({
      to: 'voxelveda1@gmail.com',
      subject: `Voxel Veda AI Lead - ${name}`,
      html,
      text,
      replyTo: email
    });

    return res.json({ message: 'Lead sent successfully.' });
  } catch (err) {
    console.error('AI LEAD EMAIL ERROR:', err);
    return res.status(500).json({ message: 'Lead email failed.' });
  }
};
