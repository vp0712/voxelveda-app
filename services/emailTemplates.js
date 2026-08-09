function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function interpolate(template, variables, escapeValues = false) {
  return String(template || '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, key) => {
    const value = variables[key] ?? '';
    return escapeValues ? escapeHtml(value) : String(value);
  });
}

function brandedLayout(content, previewText = '') {
  return `<!doctype html>
  <html><body style="margin:0;background:#eef3f7;font-family:Arial,sans-serif;color:#13202d">
    <span style="display:none;max-height:0;overflow:hidden">${escapeHtml(previewText)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f7;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background:#fff;border:1px solid #d8e2ea">
          <tr><td style="padding:22px 28px;background:#10283a;color:#fff"><strong style="font-size:20px">VOXEL VEDA</strong><br><span style="font-size:12px;color:#8fe3dc">Innovation in Motion</span></td></tr>
          <tr><td style="padding:30px 28px;line-height:1.55">${content}</td></tr>
          <tr><td style="padding:18px 28px;background:#f5f8fa;color:#607080;font-size:12px">Voxel Veda Pty Ltd | info@voxelveda.com</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

const templates = {
  timesheet_approved: {
    subject: 'Timesheet approved | {{week_start}} to {{week_end}}',
    preview: 'Your Voxel Veda timesheet has been approved.',
    body: '<h2 style="margin-top:0">Timesheet approved</h2><p>Hello {{staff_name}},</p><p>Your timesheet for <strong>{{week_start}} to {{week_end}}</strong> has been approved.</p><p><strong>Approved hours:</strong> {{approved_hours}}<br><strong>Approved by:</strong> {{manager_name}}<br><strong>Approval time:</strong> {{approved_at}}</p><p>This approved record is now ready for payroll review.</p>',
    text: 'Hello {{staff_name}}, your timesheet for {{week_start}} to {{week_end}} has been approved for {{approved_hours}} hours by {{manager_name}}.'
  },
  timesheet_rejected: {
    subject: 'Timesheet review outcome | {{week_start}} to {{week_end}}',
    preview: 'Your timesheet requires attention.',
    body: '<h2 style="margin-top:0">Timesheet rejected</h2><p>Hello {{staff_name}},</p><p>Your timesheet for <strong>{{week_start}} to {{week_end}}</strong> was not approved.</p><p><strong>Manager comments:</strong> {{manager_comments}}</p><p>Please contact your manager if you need clarification.</p>',
    text: 'Hello {{staff_name}}, your timesheet for {{week_start}} to {{week_end}} was rejected. Manager comments: {{manager_comments}}'
  },
  timesheet_correction: {
    subject: 'Timesheet correction requested | {{week_start}} to {{week_end}}',
    preview: 'A correction is required before approval.',
    body: '<h2 style="margin-top:0">Correction requested</h2><p>Hello {{staff_name}},</p><p>Your timesheet for <strong>{{week_start}} to {{week_end}}</strong> needs a correction.</p><p><strong>Manager comments:</strong> {{manager_comments}}</p><p>Update the record and resubmit it for approval.</p>',
    text: 'Hello {{staff_name}}, a correction is required for your timesheet {{week_start}} to {{week_end}}. Manager comments: {{manager_comments}}'
  },
  general_notification: {
    subject: '{{subject}}',
    preview: '{{preview}}',
    body: '<h2 style="margin-top:0">{{title}}</h2><p>{{message}}</p>',
    text: '{{title}}\n\n{{message}}'
  }
};

function renderEmailTemplate(templateKey, variables = {}) {
  const template = templates[templateKey] || templates.general_notification;
  const subject = interpolate(template.subject, variables);
  const preview = interpolate(template.preview, variables);
  const body = interpolate(template.body, variables, true);
  const text = interpolate(template.text, variables);
  return { subject, html: brandedLayout(body, preview), text };
}

module.exports = { renderEmailTemplate, brandedLayout, templates };
