const nodemailer = require('nodemailer');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { companyProfile } = require('../config/companyProfile');
const { validatePdf, safePdfFilename } = require('./documentPdfService');
const { assertWeeklyDeliveryPolicy } = require('./weeklyDeliveryPolicy');

const SMTP_FIELDS = {
  host: ['SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST'],
  port: ['SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT'],
  user: ['SMTP_USERNAME', 'SMTP_USER', 'EMAIL_USER', 'MAIL_USER'],
  pass: ['SMTP_PASSWORD', 'SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS', 'EMAIL_PASSWORD'],
  fromEmail: ['MAIL_FROM_ADDRESS', 'FROM_EMAIL', 'EMAIL_FROM', 'MAIL_FROM'],
  fromName: ['MAIL_FROM_NAME', 'FROM_NAME']
};

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function smtpConfig() {
  const profile = companyProfile();
  const user = firstEnv(SMTP_FIELDS.user) || profile.email;
  const port = Number(firstEnv(SMTP_FIELDS.port) || 465);
  return {
    host: firstEnv(SMTP_FIELDS.host) || 'smtp.hostinger.com',
    port,
    user,
    pass: firstEnv(SMTP_FIELDS.pass),
    fromEmail: firstEnv(SMTP_FIELDS.fromEmail) || profile.email || user,
    fromName: firstEnv(SMTP_FIELDS.fromName) || profile.name,
    secure: process.env.SMTP_SECURE === undefined
      ? port === 465
      : String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    replyTo: profile.replyTo
  };
}

function missingSmtpKeys() {
  const config = smtpConfig();
  const missing = [];
  if (!config.host) missing.push('SMTP_HOST');
  if (!config.port) missing.push('SMTP_PORT');
  if (!config.user) missing.push('SMTP_USERNAME');
  if (!config.pass) missing.push('SMTP_PASSWORD');
  if (!config.fromEmail) missing.push('MAIL_FROM_ADDRESS');
  return missing;
}

function relayConfig() {
  const requestedTimeout = Number(process.env.WORDPRESS_MAIL_RELAY_TIMEOUT_MS || 15000);
  return {
    url: String(process.env.WORDPRESS_MAIL_RELAY_URL || '').trim(),
    token: String(process.env.WORDPRESS_MAIL_RELAY_TOKEN || '').trim(),
    timeoutMs: Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
      ? Math.min(requestedTimeout, 60000)
      : 15000
  };
}

function isRelayConfigured() {
  const config = relayConfig();
  return Boolean(config.url.startsWith('https://') && config.token);
}

function hostingerMailApiConfig() {
  return {
    baseUrl: String(process.env.HOSTINGER_MAIL_API_BASE_URL || 'https://api.mail.hostinger.com').trim().replace(/\/+$/, ''),
    token: String(process.env.HOSTINGER_MAIL_API_TOKEN || '').trim(),
    mailboxResourceId: String(process.env.HOSTINGER_MAILBOX_RESOURCE_ID || '').trim(),
    timeoutMs: Math.max(3000, Math.min(Number(process.env.HOSTINGER_MAIL_API_TIMEOUT_MS || 20000), 60000))
  };
}

function isHostingerMailApiConfigured() {
  const config = hostingerMailApiConfig();
  return Boolean(config.baseUrl.startsWith('https://') && config.token && config.mailboxResourceId);
}

function isEmailConfigured() {
  return isHostingerMailApiConfigured() || isRelayConfigured() || missingSmtpKeys().length === 0;
}

const EMAIL_TRANSPORT_CODES = new Set([
  'SMTP_CONFIG_MISSING',
  'EAUTH',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EDNS',
  'EMAIL_HTTPS_RELAY_FAILED',
  'DELIVERY_REVIEW_REQUIRED',
  'PDF_ATTACHMENT_RELAY_FILENAME_UNSAFE',
  'PDF_RELAY_CONTRACT_REQUIRED'
]);

function isEmailTransportError(error) {
  const code = String(error?.code || '').toUpperCase();
  return EMAIL_TRANSPORT_CODES.has(code) || /smtp|socket|connection|timed?\s*out/i.test(String(error?.message || ''));
}

function classifySmtpFailure(error) {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0) || null;
  const command = String(error?.command || '').toUpperCase() || null;
  if (code === 'EAUTH' || [530, 534, 535].includes(responseCode)) return { category: 'AUTHENTICATION', retryable: false, code: code || 'EAUTH', response_code: responseCode, command };
  if (code === 'ETIMEDOUT') return { category: 'TIMEOUT', retryable: true, code, response_code: responseCode, command };
  if (code === 'EDNS') return { category: 'DNS', retryable: true, code, response_code: responseCode, command };
  if (['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ECONNECTION','ESOCKET'].includes(code)) return { category: 'NETWORK', retryable: true, code, response_code: responseCode, command };
  if (responseCode && responseCode >= 500) return { category: 'PROVIDER_REJECTION', retryable: false, code: code || 'SMTP_REJECTED', response_code: responseCode, command };
  if (responseCode && responseCode >= 400) return { category: 'PROVIDER_TEMPORARY', retryable: true, code: code || 'SMTP_TEMPORARY', response_code: responseCode, command };
  return { category: 'UNKNOWN', retryable: true, code: code || 'SMTP_CONNECTION_FAILED', response_code: responseCode, command };
}

function smtpReadinessSummary(error = null) {
  const config = smtpConfig();
  const base = {
    configured: isEmailConfigured(),
    host: config.host,
    port: config.port,
    secure: config.secure,
    identity_domain: String(config.user || '').split('@')[1] || null,
    from_domain: String(config.fromEmail || '').split('@')[1] || null,
    missing: missingSmtpKeys()
  };
  return error ? { ...base, ok: false, failure: classifySmtpFailure(error) } : { ...base, ok: true, failure: null };
}

function emailFailureDetails(error) {
  const code = String(error?.code || 'EMAIL_DELIVERY_FAILED').toUpperCase();

  if(code==='DELIVERY_REVIEW_REQUIRED')return {status:409,code,message:error.message,retryable:false,provider_accepted:error.providerAccepted===true,recipient_verified:false};

  if (code === 'PDF_RELAY_CONTRACT_REQUIRED') return { status: 503, code, message: error.message, retryable: false };
  if (code.startsWith('PDF_')) return { status: 422, code, message: error.message, retryable: false };

  if (code === 'SMTP_CONFIG_MISSING') {
    return {
      status: 503,
      code,
      message: 'Company email setup is incomplete. Preview or download the document while an administrator completes email configuration.',
      missing: missingSmtpKeys(),
      retryable: false
    };
  }

  if (code === 'EAUTH') {
    return {
      status: 503,
      code: 'EMAIL_AUTHENTICATION_FAILED',
      message: 'The company mailbox rejected the sign-in. An administrator must verify the mailbox credentials before direct delivery can resume.',
      retryable: false
    };
  }

  if (isEmailTransportError(error)) {
    return {
      status: 503,
      code: 'EMAIL_TRANSPORT_UNAVAILABLE',
      message: 'Company email delivery is unavailable from the current hosting connection. The request remains queued for a controlled retry; validated documents remain available to preview or download.',
      retryable: true
    };
  }

  return {
    status: 502,
    code: 'EMAIL_DELIVERY_FAILED',
    message: 'The email provider could not complete delivery. The document is still ready to preview or download.',
    retryable: true
  };
}

function normalizeAddressList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function validateRecipients(value, field = 'recipient') {
  const recipients = normalizeAddressList(value);
  const invalid = recipients.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!recipients.length && field === 'to') {
    const error = new Error('At least one valid recipient is required.');
    error.code = 'EMAIL_RECIPIENT_REQUIRED';
    throw error;
  }
  if (invalid.length) {
    const error = new Error(`Invalid ${field}: ${invalid.join(', ')}`);
    error.code = 'EMAIL_RECIPIENT_INVALID';
    throw error;
  }
  return recipients;
}

function createTransporter() {
  const missing = missingSmtpKeys();
  if (missing.length) {
    const error = new Error(`SMTP is not configured. Missing: ${missing.join(', ')}`);
    error.code = 'SMTP_CONFIG_MISSING';
    throw error;
  }

  const config = smtpConfig();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 30000),
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 3),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100)
  });
}

function attachmentBuffer(attachment) {
  if (!attachment) return null;
  if (Buffer.isBuffer(attachment.content)) return attachment.content;
  if (attachment.content?.type === 'Buffer' && Array.isArray(attachment.content.data)) return Buffer.from(attachment.content.data);
  if (ArrayBuffer.isView(attachment.content)) {
    return Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);
  }
  if (attachment.content instanceof ArrayBuffer) return Buffer.from(attachment.content);
  if (attachment.content !== undefined && attachment.content !== null) {
    if (typeof attachment.content !== 'string') {
      const error = new Error('Email attachment content must contain binary bytes or encoded text.');
      error.code = 'EMAIL_ATTACHMENT_CONTENT_INVALID';
      throw error;
    }
    const encoding = String(attachment.encoding || 'utf8').toLowerCase();
    if (!Buffer.isEncoding(encoding)) {
      const error = new Error('Email attachment encoding is unsupported.');
      error.code = 'EMAIL_ATTACHMENT_ENCODING_INVALID';
      throw error;
    }
    return Buffer.from(
      attachment.content,
      encoding
    );
  }
  return null;
}

function isPdfAttachment(attachment) {
  const filename = String(attachment?.filename || '').toLowerCase();
  const contentType = String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
  return filename.endsWith('.pdf') || contentType === 'application/pdf';
}

async function assertAttachmentIntegrity(attachments = []) {
  const validated = [];
  for (const attachment of attachments) {
    if (!attachment || !String(attachment.filename || '').toLowerCase().endsWith('.pdf')) {
      throw Object.assign(new Error('Document attachments must have a .pdf filename. No email was sent.'), { code: 'PDF_ATTACHMENT_FILENAME_INVALID' });
    }
    const buffer = attachment.path ? await fs.promises.readFile(attachment.path) : attachmentBuffer(attachment);
    const validation = await validatePdf(buffer, { expectedText: attachment.expectedText || [] });
    validated.push({ filename: safePdfFilename(attachment.filename), contentType: 'application/pdf', contentDisposition: 'attachment', content: buffer, validation });
  }
  return validated;
}

async function assertRelayPdfCapability() {
  const config = relayConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.url.replace(/\/+$/, '')}/health`, {
      method: 'GET', headers: { 'X-Voxel-Veda-Relay-Token': config.token }, signal: controller.signal
    });
    let health = {};
    try { health = await response.json(); } catch {}
    if (!response.ok || !health || typeof health !== 'object' || Array.isArray(health) || health.ok === false || Number(health.attachment_contract_version) < 3 || health.pdf_bytes_validated !== true || health.attachment_filename_preserved !== true) {
      throw Object.assign(new Error('The company email relay must support validated PDF bytes and original .pdf filenames before document email can be sent. The request is retained for controlled retry.'), { code: 'PDF_RELAY_CONTRACT_REQUIRED' });
    }
    return health;
  } finally { clearTimeout(timeout); }
}

async function sendViaSmtp({ to, cc, bcc, subject, html, text, replyTo, attachments = [], deliveryKey, deliveryPolicy }) {
  assertWeeklyDeliveryPolicy({ deliveryKey, deliveryPolicy }, { to, cc, bcc });
  attachments = await assertAttachmentIntegrity(attachments);
  const config = smtpConfig();
  const transporter = createTransporter();
  try {
    const result = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      cc: cc?.length ? cc : undefined,
      bcc: bcc?.length ? bcc : undefined,
      subject: String(subject || '').trim(),
      html: html || undefined,
      text: text || undefined,
      replyTo: replyTo || config.replyTo || undefined,
      attachments
    });
    if (deliveryPolicy && (result.rejected?.length || !Array.isArray(result.accepted) || result.accepted.length !== 1 || String(result.accepted[0]).toLowerCase() !== deliveryPolicy.recipient.toLowerCase())) throw Object.assign(new Error('The SMTP recipient outcome requires review before retry.'), {code:'DELIVERY_REVIEW_REQUIRED',providerAccepted:Boolean(result.accepted?.length)});
    return { ...result, transport: 'smtp', attachmentFilenameGuaranteed: true, receivedVerified: false };
  } finally {
    transporter.close();
  }
}

async function verifyConnection() {
  let relayResult = null;
  const primaryTransport = selectedEmailTransport();
  if(primaryTransport==='smtp' && missingSmtpKeys().length)throw Object.assign(new Error('The selected SMTP transport is incomplete.'),{code:'SMTP_CONFIG_MISSING'});
  if(primaryTransport==='hostinger_mail_api')throw Object.assign(new Error('The selected HTTPS mail API requires an authorised provider health check. Configuration alone does not verify connectivity or recipient delivery.'),{code:'EMAIL_TRANSPORT_VERIFICATION_UNSUPPORTED'});
  if(primaryTransport==='https_relay' && !isRelayConfigured())throw Object.assign(new Error('The configured HTTPS company relay is incomplete.'),{code:'EMAIL_HTTPS_RELAY_FAILED'});
  if (primaryTransport==='https_relay' && isRelayConfigured()) {
    const config = relayConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.url.replace(/\/+$/, '')}/health`, {
        method: 'GET',
        headers: { 'X-Voxel-Veda-Relay-Token': config.token },
        signal: controller.signal
      });
      if (!response.ok) {
        const error = new Error(`WordPress mail relay health check returned ${response.status}`);
        error.code = 'EMAIL_HTTPS_RELAY_FAILED';error.relayHttpStatus=response.status;error.relayReason='RELAY_HEALTH_HTTP_ERROR';
        throw error;
      }
      let health = {};
      try { health = await response.json(); } catch {}
      if (!health || typeof health !== 'object' || Array.isArray(health) || health.ok !== true) {
        throw Object.assign(new Error('The company relay did not return a valid successful JSON health response. Connectivity and PDF capability remain unverified.'), {code:'EMAIL_HTTPS_RELAY_FAILED',relayHttpStatus:response.status,relayReason:'RELAY_HEALTH_JSON_NOT_READY'});
      }
      relayResult = { configured: true, ok: true, provider: 'wordpress_wp_mail', transport: 'https_relay', pdf_attachment_contract_version: Number(health.attachment_contract_version || 0), pdf_attachments_supported: Number(health.attachment_contract_version || 0) >= 3 && health.pdf_bytes_validated === true && health.attachment_filename_preserved === true, recipient_verified: false };
      let relayEndpoint='configured';
      try {
        const relayUrl=new URL(config.url);
        relayEndpoint=relayUrl.hostname + relayUrl.pathname;
      } catch {}
      console.log('Email HTTPS relay evidence: ok=yes provider=wordpress_wp_mail transport=https_relay endpoint=' + relayEndpoint);
      if (primaryTransport === 'https_relay') {
        console.log('SMTP transport probe skipped: HTTPS relay is configured as the primary production mail transport.');
        return relayResult;
      }
    } catch (error) {
      if (!error.code || error.name === 'AbortError') error.code = 'EMAIL_HTTPS_RELAY_FAILED';
      console.warn(`Email HTTPS relay evidence: ok=no provider=wordpress_wp_mail code=${error.code} http_status=${Number(error.relayHttpStatus)||'unknown'} reason=${error.relayReason||error.cause?.code||error.name||'unknown'}`);
      if (missingSmtpKeys().length || primaryTransport === 'https_relay') throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!missingSmtpKeys().length) {
    const transporter = createTransporter();
    try {
      await transporter.verify();
      const summary = smtpReadinessSummary();
      console.log(`SMTP transport evidence: ok=yes host=${summary.host} port=${summary.port} secure=${summary.secure ? 'yes' : 'no'} identity_domain=${summary.identity_domain || 'unknown'} from_domain=${summary.from_domain || 'unknown'} attachment_pdf=yes`);
      return { ...summary, transport: 'smtp', relay: relayResult, recipient_verified: false };
    } catch (error) {
      const summary = smtpReadinessSummary(error);
      const f = summary.failure;
      console.warn(`SMTP transport evidence: ok=no category=${f.category} code=${f.code} response_code=${f.response_code || 'none'} command=${f.command || 'none'} host=${summary.host} port=${summary.port} secure=${summary.secure ? 'yes' : 'no'} attachment_pdf=no`);
      error.smtpReadiness = summary;
      if (!relayResult || primaryTransport==='smtp') throw error;
      return { ...relayResult, smtp: summary, attachment_pdf: false };
    } finally {
      transporter.close();
    }
  }
  return relayResult || { ...smtpReadinessSummary(), transport: 'smtp', recipient_verified: false };
}

function safeAttachmentFilename(value, contentType = '') {
  let filename = String(value || 'attachment').trim().replace(/[\\/\r\n\0]/g, '-').replace(/\s+/g, ' ').slice(0, 180);
  if (!filename) filename = 'attachment';
  if (String(contentType).toLowerCase() === 'application/pdf' && !filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';
  return filename;
}

async function relayAttachments(attachments = []) {
  attachments = await assertAttachmentIntegrity(attachments);
  let totalBytes = 0;
  const encoded = [];
  for (const attachment of attachments) {
    let content;
    if (attachment?.path) {
      content = await fs.promises.readFile(attachment.path);
    } else {
      content = attachmentBuffer(attachment);
    }
    if (!content) {
      const error = new Error('Email attachment has no readable content.');
      error.code = 'EMAIL_ATTACHMENT_CONTENT_MISSING';
      throw error;
    }
    totalBytes += content.length;
    if (totalBytes > 20 * 1024 * 1024) {
      const error = new Error('Email relay attachments exceed the 20 MB limit.');
      error.code = 'EMAIL_RELAY_ATTACHMENT_LIMIT';
      throw error;
    }
    const contentType = String(attachment.contentType || attachment.content_type || 'application/octet-stream').slice(0, 120);
    const filename = safeAttachmentFilename(attachment.filename, contentType);
    const contentBase64 = content.toString('base64');
    encoded.push({
      filename,
      name: filename,
      original_filename: filename,
      content: contentBase64,
      data: contentBase64,
      encoding: 'base64',
      contentType,
      mime_type: contentType,
      contentDisposition: String(attachment.contentDisposition || 'attachment'),
      content_type: contentType,
      content_base64: contentBase64,
      byte_length: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    });
  }
  return encoded;
}

async function sendViaHostingerMailApi({ to, cc, bcc, subject, html, text, attachments = [], deliveryKey, deliveryPolicy }) {
  assertWeeklyDeliveryPolicy({ deliveryKey, deliveryPolicy }, { to, cc, bcc });
  if (deliveryPolicy) throw Object.assign(new Error('The Hostinger API has no verified final-recipient privacy contract for weekly timesheets. Keep the request pending and verify the configured transport before sending.'), {code:'DELIVERY_REVIEW_REQUIRED',reasonCode:'WEEKLY_TRANSPORT_PRIVACY_UNVERIFIED'});
  const config = hostingerMailApiConfig();
  if (!isHostingerMailApiConfigured()) {
    const error = new Error('Hostinger Mail API transport is not configured.');
    error.code = 'HOSTINGER_MAIL_API_CONFIG_MISSING';
    throw error;
  }
  const encoded = await relayAttachments(attachments);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(
      config.baseUrl + '/api/v1/mailboxes/' + encodeURIComponent(config.mailboxResourceId) + '/send',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + config.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to,
          cc: cc?.length ? cc : undefined,
          bcc: bcc?.length ? bcc : undefined,
          subject: String(subject || '').trim(),
          html: html || undefined,
          text: text || undefined,
          displayName: smtpConfig().fromName,
          attachments: encoded.map((item) => ({
            filename: item.filename,
            content: item.content,
            contentType: item.contentType,
            encoding: 'base64'
          }))
        }),
        signal: controller.signal
      }
    );
    if (response.status !== 204) {
      let details = {};
      try { details = await response.json(); } catch {}
      const error = new Error(details.error || details.message || 'Hostinger Mail API returned ' + response.status);
      error.code = String(details.code || 'HOSTINGER_MAIL_API_FAILED');
      error.responseCode = response.status;
      throw error;
    }
    return { messageId: null, accepted: to, transport: 'hostinger_mail_api', attachmentFilenameGuaranteed: true, receivedVerified: false };
  } catch (error) {
    if (error.name === 'AbortError') {
      error.code = 'HOSTINGER_MAIL_API_TIMEOUT';
      error.message = 'Hostinger Mail API timed out.';
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaHttpsRelay({ to, cc, bcc, subject, html, text, replyTo, attachments = [], deliveryKey, deliveryPolicy }) {
  assertWeeklyDeliveryPolicy({ deliveryKey, deliveryPolicy }, { to, cc, bcc });
  if (attachments.length) {
    const health = await assertRelayPdfCapability();
    if (deliveryPolicy && health.weekly_recipient_privacy_enforced !== true) throw Object.assign(new Error('The existing relay must enforce the designated single recipient through final MIME construction before weekly timesheets can be sent.'), {code:'PDF_RELAY_CONTRACT_REQUIRED'});
  }
  const config = relayConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let attempted=false;
  try {
    const encodedAttachments=(await relayAttachments(attachments)).map(item => ({ filename: item.filename, contentType: 'application/pdf', contentDisposition: 'attachment', content_base64: item.content_base64, byte_length: item.byte_length, sha256: item.sha256 }));
    attempted=true;
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Voxel-Veda-Relay-Token': config.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to,
        cc,
        bcc,
        subject: String(subject || '').trim(),
        html: html || '',
        text: text || '',
        reply_to: replyTo || '',
        request_id: deliveryKey || `railway:${crypto.createHash('sha256').update(JSON.stringify({to,cc,bcc,subject,text,html,attachments:attachments.map(item=>({filename:item.filename,sha256:crypto.createHash('sha256').update(item.content).digest('hex')}))})).digest('hex')}`,
        attachment_contract_version: 3,
        preserve_attachment_filenames: true,
        delivery_policy: deliveryPolicy || undefined,
        attachments: encodedAttachments
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }
    if (!response.ok || result.sent !== true) {
      const knownAcceptance = result.sent === true || result.provider_accepted === true || result.data?.provider_accepted === true;
      // A proxy/receiver may emit an error or HTML after the provider accepted
      // the request. Only its explicit pre-transport validation rejection is
      // definitive; all other POST outcomes require review before another send.
      const definitiveRejection = !response.ok && !knownAcceptance && ['PDF_RELAY_VALIDATION_FAILED','INVALID_REQUEST_ID'].includes(result.code);
      const error = new Error(definitiveRejection
        ? result.message || 'The relay rejected this request before mail transport. Repair it before a controlled retry.'
        : result.code === 'DELIVERY_REVIEW_REQUIRED' && result.message
          ? result.message
          : 'The relay did not confirm the outcome of this attempted mail transaction. Review provider logs before retry; no automatic resend is permitted.');
      error.code = definitiveRejection ? 'PDF_RELAY_VALIDATION_FAILED' : 'DELIVERY_REVIEW_REQUIRED';
      error.responseCode = response.status;
      error.providerAccepted = knownAcceptance;
      throw error;
    }
    if(attachments.length){
      const received=Array.isArray(result.attachments)?result.attachments:[];
      const validContract=Number(result.attachment_contract_version)>=3 && result.pdf_bytes_validated===true && result.attachment_filename_preserved===true;
      const exactParts=received.length===encodedAttachments.length && encodedAttachments.every((part,index)=>{
        const claim=received[index] || {};
        return claim.filename===part.filename && claim.contentType==='application/pdf' && Number(claim.byte_length)===part.byte_length && claim.sha256===part.sha256 && Number(claim.pages)>=1;
      });
      if(!validContract || !exactParts)throw Object.assign(new Error('The relay accepted this message without confirming the exact validated PDF attachment metadata. Administrator review is required before retry; recipient receipt remains unverified.'),{code:'DELIVERY_REVIEW_REQUIRED',providerAccepted:true});
    }
    if (deliveryPolicy && (result.weekly_recipient_privacy_enforced !== true || result.designated_recipient !== deliveryPolicy.recipient)) throw Object.assign(new Error('The relay accepted the weekly message without confirming its exact designated recipient and zero copies. Review provider logs before any retry.'), {code:'DELIVERY_REVIEW_REQUIRED',providerAccepted:true});
    return {
      messageId: result.provider_message_id || result.request_id || null,
      accepted: to,
      // This is only the relay's claim; it is never recipient-side verification.
      attachmentFilenameGuaranteed: result.attachment_filename_preserved === true,
      attachmentContractVersion: Number(result.attachment_contract_version || 0),
      receivedVerified: false
    };
  } catch (error) {
    if(attempted && !['DELIVERY_REVIEW_REQUIRED','PDF_RELAY_VALIDATION_FAILED'].includes(error.code)){error.code='DELIVERY_REVIEW_REQUIRED';error.message='The relay transaction outcome is uncertain. Review provider logs before retry to prevent duplicate delivery.';}
    if(!error.code)error.code='EMAIL_HTTPS_RELAY_FAILED';
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function selectedEmailTransport() {
  const configured=String(process.env.EMAIL_PRIMARY_TRANSPORT || '').trim().toLowerCase();
  if(configured && !['smtp','https_relay','hostinger_mail_api'].includes(configured))throw Object.assign(new Error('The configured company email transport is unsupported. Administrator review is required.'),{code:'EMAIL_TRANSPORT_CONFIG_INVALID'});
  return configured || (isRelayConfigured()?'https_relay':isHostingerMailApiConfigured()?'hostinger_mail_api':'smtp');
}
async function sendMail({ to, cc, bcc, subject, html, text, replyTo, attachments = [], deliveryKey, deliveryPolicy }) {
  const args = {
    to: validateRecipients(to, 'to'),
    cc: validateRecipients(cc, 'cc'),
    bcc: validateRecipients(bcc, 'bcc'),
    subject, html, text, replyTo, deliveryKey, deliveryPolicy,
    attachments: await assertAttachmentIntegrity(attachments)
  };
  assertWeeklyDeliveryPolicy(args, args);
  // Explicit transport selection is honoured; no provider change is inferred from PDF failures.
  const selected = selectedEmailTransport();
  if (selected === 'smtp') return sendViaSmtp(args);
  if (selected === 'hostinger_mail_api') return sendViaHostingerMailApi(args);
  if (selected === 'https_relay' && !isRelayConfigured()) throw Object.assign(new Error('The configured HTTPS company relay is incomplete.'), {code:'EMAIL_HTTPS_RELAY_FAILED'});
  if (isRelayConfigured()) return { ...await sendViaHttpsRelay(args), transport: 'https_relay' };
  if (missingSmtpKeys().length && isHostingerMailApiConfigured()) return sendViaHostingerMailApi(args);
  return sendViaSmtp(args);
}

module.exports = {
  sendMail,
  selectedEmailTransport,
  verifyConnection,
  createTransporter,
  isEmailConfigured,
  missingSmtpKeys,
  smtpConfig,
  smtpReadinessSummary,
  classifySmtpFailure,
  isRelayConfigured,
  relayConfig,
  isHostingerMailApiConfigured,
  hostingerMailApiConfig,
  sendViaHostingerMailApi,
  relayAttachments,
  safeAttachmentFilename,
  normalizeAddressList,
  validateRecipients,
  isEmailTransportError,
  emailFailureDetails,
  assertAttachmentIntegrity,
  assertRelayPdfCapability,
  attachmentBuffer,
  isPdfAttachment,
  sendViaSmtp
};
