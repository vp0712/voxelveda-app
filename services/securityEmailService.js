const { sendMail } = require('./emailService');

function appUrl(path) {
  return new URL(path, process.env.APP_URL || 'https://app.voxelveda.com').toString();
}

async function queueSecurityLink({ user, token, type, createdBy }) {
  const invite = type === 'INVITE';
  const url = `${appUrl(invite ? '/accept-invite' : '/reset-password')}#token=${encodeURIComponent(token)}`;
  const title = invite ? 'Your Voxel Veda work account invitation' : 'Reset your Voxel Veda password';
  const action = invite ? 'Set up your account' : 'Reset password';
  const expiry = invite ? '24 hours' : '30 minutes';
  return sendMail({
    to: user.email,
    subject: title,
    text: `${title}\n\n${action}: ${url}\n\nThis single-use link expires in ${expiry}. If you did not expect this, contact your administrator.`,
    html: `<h2>${title}</h2><p>Hello ${String(user.name || 'User').replace(/[<>&]/g, '')},</p><p><a href="${url}">${action}</a></p><p>This single-use link expires in ${expiry}. If you did not expect this, contact your administrator.</p>`
  });
}

module.exports = { queueSecurityLink };
