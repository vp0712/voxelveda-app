const DEFAULT_COMPANY_EMAIL = 'info@voxelveda.com';

function firstValue(values) {
  for (const value of values) {
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function companyProfile() {
  const email = firstValue([
    process.env.MAIL_FROM_ADDRESS,
    process.env.FROM_EMAIL,
    process.env.EMAIL_FROM,
    process.env.COMPANY_EMAIL,
    DEFAULT_COMPANY_EMAIL
  ]);

  return {
    name: firstValue([process.env.COMPANY_NAME, process.env.MAIL_FROM_NAME, 'Voxel Veda']),
    legalName: firstValue([process.env.COMPANY_LEGAL_NAME, 'Voxel Veda Pty Ltd']),
    email,
    supportEmail: firstValue([process.env.SUPPORT_EMAIL, email]),
    replyTo: firstValue([process.env.MAIL_REPLY_TO, email]),
    website: firstValue([process.env.PUBLIC_WEBSITE_URL, 'https://voxelveda.com'])
  };
}

module.exports = { companyProfile, DEFAULT_COMPANY_EMAIL };
