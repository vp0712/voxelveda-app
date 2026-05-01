const nodemailer = require('nodemailer');

async function testSMTP() {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: {
        user: 'info@voxelveda.com',
        pass: 'Viral@0712'
      }
    });

    await transporter.verify();
    console.log('SMTP verified successfully');

    const info = await transporter.sendMail({
      from: '"Voxel Veda" <info@voxelveda.com>',
      to: 'info@voxelveda.com',
      subject: 'SMTP Test',
      text: 'This is a direct SMTP test.'
    });

    console.log('Email sent:', info.messageId);
  } catch (error) {
    console.error('SMTP TEST ERROR:', error);
  }
}

testSMTP();