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
    website: firstValue([process.env.PUBLIC_WEBSITE_URL, 'https://voxelveda.com']),
    phone: firstValue([process.env.COMPANY_PHONE, process.env.PUBLIC_COMPANY_PHONE]),
    address: firstValue([process.env.COMPANY_ADDRESS, process.env.PUBLIC_COMPANY_ADDRESS]),
    abn: firstValue([process.env.COMPANY_ABN]),
    bankName: firstValue([process.env.COMPANY_BANK_NAME]),
    bankAccountName: firstValue([process.env.COMPANY_BANK_ACCOUNT_NAME, process.env.COMPANY_LEGAL_NAME, 'Voxel Veda Pty Ltd']),
    bankBsb: firstValue([process.env.COMPANY_BANK_BSB]),
    bankAccountNumber: firstValue([process.env.COMPANY_BANK_ACCOUNT_NUMBER]),
    invoiceTermsDays: Number(process.env.COMPANY_INVOICE_TERMS_DAYS || 7)
  };
}

module.exports = { companyProfile, DEFAULT_COMPANY_EMAIL };
