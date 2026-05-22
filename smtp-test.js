require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSMTP() {
  try {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length) {
      throw new Error(`Missing SMTP environment values: ${missing.join(', ')}`);
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE || 'true') === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.verify();
    console.log('SMTP verified successfully');

    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Voxel Veda'}" <${process.env.FROM_EMAIL}>`,
      to: process.env.SMTP_TEST_TO || process.env.FROM_EMAIL,
      subject: 'SMTP Test',
      text: 'This is a direct SMTP test.'
    });

    console.log('Email sent:', info.messageId);
  } catch (error) {
    console.error('SMTP TEST ERROR:', error);
  }
}

testSMTP();
