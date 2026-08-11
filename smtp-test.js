require('dotenv').config();
const { verifyConnection, sendMail, smtpConfig } = require('./services/emailService');

async function testSMTP() {
  try {
    const result = await verifyConnection();
    console.log(`SMTP verified successfully (${result.host}:${result.port})`);

    const info = await sendMail({
      to: process.env.SMTP_TEST_TO || smtpConfig().fromEmail,
      subject: 'Voxel Veda email delivery test',
      text: 'Voxel Veda secure email delivery is working correctly.'
    });

    console.log('Email sent:', info.messageId);
  } catch (error) {
    console.error('SMTP TEST ERROR:', error);
  }
}

testSMTP();
