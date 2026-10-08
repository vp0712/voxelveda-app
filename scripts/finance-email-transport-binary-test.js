'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const mail = require('../services/emailService');
const pool = require('../config/db');

async function run() {
  const bytes = await new Promise((resolve, reject) => {
    const doc = new PDFDocument(), chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text('Finance transport regression: FIN-BINARY-TEST');
    doc.text('2026-09-30 to 2026-10-06 | AUD | Paper invoice | Debit 123.45');
    doc.end();
  });
  const filename = 'Voxel-Veda-Finance-2026-09-30-to-2026-10-06.pdf';
  const base = { filename, contentType: 'application/pdf', contentDisposition: 'attachment' };
  const binaryForms = [
    bytes, JSON.parse(JSON.stringify(bytes)), new Uint8Array(bytes),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  ];
  const padded = new Uint8Array(bytes.length + 12); padded.set(bytes, 7);
  binaryForms.push(padded.subarray(7, bytes.length + 7));
  for (const content of binaryForms) {
    const encoded = (await mail.relayAttachments([{ ...base, content }]))[0];
    assert.equal(encoded.filename, filename);
    assert.equal(encoded.original_filename, filename);
    assert.equal(encoded.contentType, 'application/pdf');
    assert.equal(encoded.contentDisposition, 'attachment');
    assert.equal(encoded.byte_length, bytes.length);
    assert.equal(encoded.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Buffer.from(encoded.content, 'base64'), bytes);
  }
  for (const encoding of ['base64', 'hex']) {
    assert.deepEqual((await mail.relayAttachments([{ ...base, content: bytes.toString(encoding), encoding }])).map(item => Buffer.from(item.content, 'base64'))[0], bytes);
  }
  await assert.rejects(() => mail.relayAttachments([{ filename }]), error => error.code === 'EMAIL_ATTACHMENT_CONTENT_MISSING');
  await assert.rejects(() => mail.relayAttachments([{ ...base, content: { stream: 'unsupported' } }]), error => error.code === 'EMAIL_ATTACHMENT_CONTENT_INVALID');
  await assert.rejects(() => mail.relayAttachments([{ ...base, content: 'bad', encoding: 'unknown' }]), error => error.code === 'EMAIL_ATTACHMENT_ENCODING_INVALID');

  const queue = require('../services/emailQueue')._test;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-email-binary-'));
  try {
    const temporary = path.join(directory, 'tmp'); fs.writeFileSync(temporary, bytes);
    const saved = await queue.serializableAttachments([{ ...base, path: temporary }]);
    fs.unlinkSync(temporary);
    delete require.cache[require.resolve('../services/emailQueue')];
    const restarted = require('../services/emailQueue')._test;
    assert.deepEqual(restarted.restoreAttachments(JSON.parse(JSON.stringify(saved)))[0].content, bytes);
    for (const content of binaryForms) {
      const serialized = await queue.serializableAttachments([{ ...base, content }]);
      assert.deepEqual(restarted.restoreAttachments(JSON.parse(JSON.stringify(serialized)))[0].content, bytes);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  const actualFetch = global.fetch;
  const keys = ['WORDPRESS_MAIL_RELAY_URL', 'WORDPRESS_MAIL_RELAY_TOKEN', 'PDF_EMAIL_TRANSPORT', 'WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED', 'HOSTINGER_MAIL_API_TOKEN'];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.WORDPRESS_MAIL_RELAY_URL = 'https://relay.example.test/mail';
    process.env.WORDPRESS_MAIL_RELAY_TOKEN = 'fixture';
    process.env.PDF_EMAIL_TRANSPORT = 'https_relay';
    delete process.env.HOSTINGER_MAIL_API_TOKEN;
    delete process.env.WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED;
    let submitted;
    global.fetch = async (_url, options) => {
      submitted = JSON.parse(options.body);
      return new Response(JSON.stringify({ sent: true, request_id: 'fixture', attachment_filename_preserved: true, attachment_contract_version: 2 }), { status: 200 });
    };
    const message = { to: 'owner@example.test', subject: 'Saved Finance report', text: 'PDF attached', attachments: [{ ...base, content: bytes }], attachmentFallback: { html: '<a href="https://app.voxelveda.com/finance/reports/fixture/view">View report</a>', text: 'Your report is ready online. PDF attachment delivery is unavailable.' } };
    const fallback = await mail.sendMail(message);
    assert.equal(fallback.attachmentOmitted, true);
    assert.equal(fallback.receivedVerified, false);
    assert.equal(submitted.attachments.length, 0, 'a relay claim cannot enable an untested attachment transport');
    assert.equal(submitted.text, message.attachmentFallback.text);
    process.env.WORDPRESS_MAIL_RELAY_PDF_FILENAME_VERIFIED = 'true';
    const accepted = await mail.sendMail({ ...message, attachments: [{ ...base, content: JSON.parse(JSON.stringify(bytes)) }] });
    assert.equal(accepted.attachmentOmitted, false);
    assert.equal(accepted.receivedVerified, false);
    assert.deepEqual(Buffer.from(submitted.attachments[0].content, 'base64'), bytes);
    assert.equal(submitted.attachments[0].filename, filename);
  } finally {
    global.fetch = actualFetch;
    for (const key of keys) originalEnv[key] === undefined ? delete process.env[key] : process.env[key] = originalEnv[key];
  }

  // This is a locally generated MIME fixture, not a claim about recipient receipt.
  const mime = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ from: 'info@voxelveda.com', to: 'owner@example.test', subject: 'Binary MIME fixture', text: 'View report', attachments: [{ ...base, content: bytes }] });
  const source = mime.message.toString('utf8');
  const part = source.split(/\r?\n(?=Content-Type:)/).find(item => item.startsWith('Content-Type: application/pdf'));
  const decoded = Buffer.from(part.split(/\r?\n\r?\n/)[1].split(/\r?\n--/)[0].replace(/\s/g, ''), 'base64');
  assert.deepEqual(decoded, bytes);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(decoded), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
  try {
    const doc = await task.promise, text = (await (await doc.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.equal(doc.numPages, 1);
    assert(text.includes('FIN-BINARY-TEST') && text.includes('Paper invoice') && text.includes('123.45'));
  } finally { await task.destroy(); }
  console.log('FINANCE_EMAIL_TRANSPORT_BINARY_OK: exact byte preservation through Buffer/JSON/typed-array/encoded-text/queue restart/MIME, parsed expected PDF data, explicit missing-content failures, truthful unverified-relay fallback. No email sent.');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
