const https = require('node:https');
const crypto = require('node:crypto');
const pool = require('../config/db');
const { backgroundJobService } = require('./backgroundJobService');

const DEFAULT_TIMEZONE = 'Australia/Melbourne';
const recentInboundMessages = new Map();

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function csvPhones(value) {
  return [...new Set(String(value || '').split(',').map(normalizePhone).filter(Boolean))];
}

function enabled() {
  return String(process.env.VOM_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
}

function configured() {
  return Boolean(
    String(process.env.VOM_WHATSAPP_PHONE_NUMBER_ID || '').trim()
    && String(process.env.VOM_WHATSAPP_ACCESS_TOKEN || '').trim()
  );
}

function recipients() {
  return csvPhones(process.env.VOM_WHATSAPP_RECIPIENTS);
}

function authorisedNumbers() {
  const explicit = csvPhones(process.env.VOM_WHATSAPP_AUTHORISED_NUMBERS);
  return explicit.length ? explicit : recipients();
}

function localParts(date = new Date(), timezone = process.env.VOM_TIMEZONE || DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return parts;
}

function hourKey(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

function displayTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: process.env.VOM_TIMEZONE || DEFAULT_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

async function scalar(sql, params = [], key = 'value', source = 'unknown', unavailable = []) {
  try {
    const [[row]] = await pool.query(sql, params);
    const value = row?.[key];
    return value == null ? 0 : Number(value);
  } catch (error) {
    unavailable.push(source);
    console.warn(`VOM source unavailable: ${source} (${error.code || 'QUERY_FAILED'})`);
    return null;
  }
}

async function collectOperationsSnapshot(now = new Date()) {
  const unavailable = [];
  const lowStockThreshold = Math.max(0, Number(process.env.VOM_LOW_STOCK_THRESHOLD || 5));

  const [
    rfqPending,
    rfqApproved,
    rfqNewHour,
    invoicesOutstanding,
    invoicesBalance,
    tasksPending,
    tasksInProgress,
    tasksOverdue,
    tasksUrgent,
    productionActive,
    productionRunning,
    productionQualityHold,
    productionMaterialWaiting,
    purchaseOrdersOpen,
    purchaseOrdersOverdue,
    workflowsPending,
    workflowsOverdue,
    lowStock,
    activeAttendance,
    highAlerts
  ] = await Promise.all([
    scalar("SELECT COUNT(*) value FROM rfqs WHERE LOWER(IFNULL(status,'')) = 'pending'", [], 'value', 'rfqs', unavailable),
    scalar("SELECT COUNT(*) value FROM rfqs WHERE LOWER(IFNULL(status,'')) = 'approved'", [], 'value', 'rfqs', unavailable),
    scalar("SELECT COUNT(*) value FROM rfqs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)", [], 'value', 'rfqs', unavailable),
    scalar(`SELECT COUNT(*) value
            FROM invoices i
            LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
            WHERE IFNULL(i.deleted,0)=0 AND GREATEST(IFNULL(i.total,0)-IFNULL(p.paid,0),0) > 0`,
      [], 'value', 'invoices', unavailable),
    scalar(`SELECT COALESCE(SUM(GREATEST(IFNULL(i.total,0)-IFNULL(p.paid,0),0)),0) value
            FROM invoices i
            LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
            WHERE IFNULL(i.deleted,0)=0`,
      [], 'value', 'invoices', unavailable),
    scalar("SELECT COUNT(*) value FROM tasks WHERE IFNULL(deleted,0)=0 AND LOWER(IFNULL(status,''))='pending'", [], 'value', 'tasks', unavailable),
    scalar("SELECT COUNT(*) value FROM tasks WHERE IFNULL(deleted,0)=0 AND LOWER(IFNULL(status,''))='in_progress'", [], 'value', 'tasks', unavailable),
    scalar("SELECT COUNT(*) value FROM tasks WHERE IFNULL(deleted,0)=0 AND LOWER(IFNULL(status,'')) <> 'done' AND due_date IS NOT NULL AND due_date < CURRENT_DATE()", [], 'value', 'tasks', unavailable),
    scalar("SELECT COUNT(*) value FROM tasks WHERE IFNULL(deleted,0)=0 AND LOWER(IFNULL(status,'')) <> 'done' AND LOWER(IFNULL(priority,''))='urgent'", [], 'value', 'tasks', unavailable),
    scalar("SELECT COUNT(*) value FROM manufacturing_jobs WHERE status NOT IN ('COMPLETE','CANCELLED')", [], 'value', 'production', unavailable),
    scalar("SELECT COUNT(*) value FROM manufacturing_jobs WHERE status='IN_PRODUCTION'", [], 'value', 'production', unavailable),
    scalar("SELECT COUNT(*) value FROM manufacturing_jobs WHERE status='QUALITY_HOLD'", [], 'value', 'production', unavailable),
    scalar("SELECT COUNT(*) value FROM manufacturing_jobs WHERE status='MATERIAL_WAITING'", [], 'value', 'production', unavailable),
    scalar("SELECT COUNT(*) value FROM purchase_orders WHERE status NOT IN ('CANCELLED','CLOSED','COMPLETE','RECEIVED')", [], 'value', 'procurement', unavailable),
    scalar("SELECT COUNT(*) value FROM purchase_orders WHERE status NOT IN ('CANCELLED','CLOSED','COMPLETE','RECEIVED') AND expected_date IS NOT NULL AND expected_date < CURRENT_DATE()", [], 'value', 'procurement', unavailable),
    scalar("SELECT COUNT(*) value FROM workflow_instances WHERE status IN ('PENDING','BLOCKED_ASSIGNMENT','NEEDS_CHANGES')", [], 'value', 'workflows', unavailable),
    scalar("SELECT COUNT(*) value FROM workflow_instances WHERE status IN ('PENDING','BLOCKED_ASSIGNMENT','NEEDS_CHANGES') AND due_at IS NOT NULL AND due_at < NOW()", [], 'value', 'workflows', unavailable),
    scalar("SELECT COUNT(*) value FROM stock_batches WHERE IFNULL(deleted,0)=0 AND IFNULL(current_unit_qty,0) <= ?", [lowStockThreshold], 'value', 'stock', unavailable),
    scalar("SELECT COUNT(*) value FROM staff_attendance WHERE IFNULL(deleted,0)=0 AND work_date=CURRENT_DATE() AND clock_in IS NOT NULL AND clock_out IS NULL", [], 'value', 'attendance', unavailable),
    scalar("SELECT COUNT(*) value FROM notifications WHERE deleted_at IS NULL AND is_read=0 AND UPPER(IFNULL(priority,'')) IN ('HIGH','CRITICAL') AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)", [], 'value', 'notifications', unavailable)
  ]);

  return {
    generated_at: now.toISOString(),
    local_time: displayTime(now),
    timezone: process.env.VOM_TIMEZONE || DEFAULT_TIMEZONE,
    rfq: { pending: rfqPending, approved: rfqApproved, new_last_hour: rfqNewHour },
    finance: { outstanding_invoices: invoicesOutstanding, balance_due_aud: invoicesBalance },
    tasks: { pending: tasksPending, in_progress: tasksInProgress, overdue: tasksOverdue, urgent: tasksUrgent },
    production: { active: productionActive, in_production: productionRunning, quality_hold: productionQualityHold, material_waiting: productionMaterialWaiting },
    procurement: { open_purchase_orders: purchaseOrdersOpen, overdue_purchase_orders: purchaseOrdersOverdue },
    workflows: { pending: workflowsPending, overdue: workflowsOverdue },
    inventory: { low_stock_items: lowStock, threshold_units: lowStockThreshold },
    workforce: { clocked_in_now: activeAttendance },
    alerts: { high_or_critical_last_hour: highAlerts },
    unavailable_sources: [...new Set(unavailable)]
  };
}

function numberOrDash(value) {
  return value == null || Number.isNaN(Number(value)) ? '—' : String(Number(value));
}

function moneyOrDash(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(Number(value));
}

function attentionLines(snapshot) {
  const lines = [];
  if (Number(snapshot.production.quality_hold || 0) > 0) lines.push(`${snapshot.production.quality_hold} production job(s) on quality hold`);
  if (Number(snapshot.production.material_waiting || 0) > 0) lines.push(`${snapshot.production.material_waiting} production job(s) waiting for material`);
  if (Number(snapshot.tasks.overdue || 0) > 0) lines.push(`${snapshot.tasks.overdue} overdue task(s)`);
  if (Number(snapshot.procurement.overdue_purchase_orders || 0) > 0) lines.push(`${snapshot.procurement.overdue_purchase_orders} overdue purchase order(s)`);
  if (Number(snapshot.workflows.overdue || 0) > 0) lines.push(`${snapshot.workflows.overdue} overdue approval/workflow item(s)`);
  if (Number(snapshot.inventory.low_stock_items || 0) > 0) lines.push(`${snapshot.inventory.low_stock_items} low-stock item(s)`);
  if (Number(snapshot.alerts.high_or_critical_last_hour || 0) > 0) lines.push(`${snapshot.alerts.high_or_critical_last_hour} new high/critical alert(s)`);
  return lines;
}

function renderHourlyReport(snapshot) {
  const attention = attentionLines(snapshot);
  const dataWarning = snapshot.unavailable_sources.length
    ? `\n⚪ Data unavailable: ${snapshot.unavailable_sources.join(', ')}`
    : '';
  const text = [
    '🟢 VOM | VOXEL VEDA OPERATIONS',
    snapshot.local_time,
    '',
    `📨 RFQs: ${numberOrDash(snapshot.rfq.pending)} pending | ${numberOrDash(snapshot.rfq.approved)} approved | +${numberOrDash(snapshot.rfq.new_last_hour)} last hour`,
    `🏭 Production: ${numberOrDash(snapshot.production.active)} active | ${numberOrDash(snapshot.production.in_production)} running | ${numberOrDash(snapshot.production.quality_hold)} hold`,
    `📦 Procurement: ${numberOrDash(snapshot.procurement.open_purchase_orders)} open PO | ${numberOrDash(snapshot.procurement.overdue_purchase_orders)} overdue`,
    `🧰 Inventory: ${numberOrDash(snapshot.inventory.low_stock_items)} low-stock`,
    `✅ Tasks: ${numberOrDash(snapshot.tasks.pending)} pending | ${numberOrDash(snapshot.tasks.in_progress)} active | ${numberOrDash(snapshot.tasks.overdue)} overdue`,
    `🧾 Finance: ${numberOrDash(snapshot.finance.outstanding_invoices)} invoices outstanding | ${moneyOrDash(snapshot.finance.balance_due_aud)} due`,
    `👷 Workforce: ${numberOrDash(snapshot.workforce.clocked_in_now)} clocked in`,
    `🧭 Approvals: ${numberOrDash(snapshot.workflows.pending)} pending | ${numberOrDash(snapshot.workflows.overdue)} overdue`,
    '',
    attention.length ? `⚠️ ATTENTION: ${attention.slice(0, 4).join('; ')}` : '✅ No critical operational exception detected from available data.',
    dataWarning,
    '',
    '— VOM • Voxel Veda'
  ].filter((line) => line !== '').join('\n');

  return text.slice(0, 3500);
}

function httpsJson({ hostname, path, method = 'POST', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = https.request({
      hostname,
      path,
      method,
      port: 443,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers
      },
      timeout: 20000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 1000) }; }
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(parsed);
        const error = new Error(parsed?.error?.message || `Provider returned HTTP ${response.statusCode}`);
        error.code = parsed?.error?.code ? `META_${parsed.error.code}` : 'WHATSAPP_PROVIDER_ERROR';
        error.statusCode = response.statusCode;
        return reject(error);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('WhatsApp provider timed out'), { code: 'WHATSAPP_TIMEOUT' })));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function sendWhatsAppPayload(to, payload) {
  if (!configured()) {
    const error = new Error('WhatsApp Cloud API is not configured.');
    error.code = 'WHATSAPP_NOT_CONFIGURED';
    throw error;
  }
  const phoneNumberId = String(process.env.VOM_WHATSAPP_PHONE_NUMBER_ID).trim();
  const graphVersion = String(process.env.VOM_META_GRAPH_VERSION || 'v27.0').trim();
  const result = await httpsJson({
    hostname: 'graph.facebook.com',
    path: `/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
    headers: { Authorization: `Bearer ${process.env.VOM_WHATSAPP_ACCESS_TOKEN}` },
    body: { messaging_product: 'whatsapp', to: normalizePhone(to), ...payload }
  });
  return { provider_message_id: result?.messages?.[0]?.id || null, raw: result };
}

async function sendWhatsAppText(to, text) {
  return sendWhatsAppPayload(to, {
    type: 'text',
    text: { preview_url: false, body: String(text || '').slice(0, 3500) }
  });
}

async function sendScheduledReport(to, reportText) {
  const mode = String(process.env.VOM_WHATSAPP_SCHEDULED_MODE || 'template').toLowerCase();
  if (mode === 'text') return sendWhatsAppText(to, reportText);

  const templateName = String(process.env.VOM_WHATSAPP_TEMPLATE_NAME || '').trim();
  if (!templateName) {
    const error = new Error('VOM WhatsApp template name is not configured.');
    error.code = 'WHATSAPP_TEMPLATE_NOT_CONFIGURED';
    throw error;
  }
  return sendWhatsAppPayload(to, {
    type: 'template',
    template: {
      name: templateName,
      language: { code: String(process.env.VOM_WHATSAPP_TEMPLATE_LANGUAGE || 'en').trim() },
      components: [{
        type: 'body',
        parameters: [{ type: 'text', text: String(reportText || '').slice(0, 3000) }]
      }]
    }
  });
}

async function completedThisHour(reportKey) {
  const [[row]] = await pool.query(
    `SELECT started_at
     FROM background_job_runs
     WHERE job_key='vom_whatsapp_hourly_report' AND status='COMPLETED'
     ORDER BY started_at DESC, run_uuid DESC
     LIMIT 1`
  );
  return Boolean(row?.started_at && hourKey(new Date(row.started_at)) === reportKey);
}

async function processHourlyReports(options = {}) {
  if (!enabled() && !options.force) return { skipped: true, reason: 'disabled', processed: 0 };
  if (!configured()) return { skipped: true, reason: 'provider_not_configured', processed: 0 };

  const targets = recipients();
  if (!targets.length) return { skipped: true, reason: 'no_recipients', processed: 0 };

  const now = options.now || new Date();
  const reportKey = hourKey(now);
  if (!options.force && await completedThisHour(reportKey)) {
    return { skipped: true, reason: 'already_completed_this_hour', processed: 0, report_key: reportKey };
  }

  const snapshot = await collectOperationsSnapshot(now);
  const reportText = renderHourlyReport(snapshot);
  const outcomes = [];

  for (const recipient of targets) {
    try {
      const sent = await sendScheduledReport(recipient, reportText);
      outcomes.push({ recipient, status: 'DELIVERED', provider_message_id: sent.provider_message_id });
    } catch (error) {
      outcomes.push({ recipient, status: 'FAILED', code: error.code || 'SEND_FAILED' });
      throw error;
    }
  }

  return {
    skipped: false,
    processed: outcomes.length,
    failed: outcomes.filter((item) => item.status === 'FAILED').length,
    report_key: reportKey,
    outcomes
  };
}

function verifyMetaSignature(rawBody, signature) {
  const secret = String(process.env.VOM_META_APP_SECRET || '');
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyWebhookChallenge(query) {
  const mode = String(query?.['hub.mode'] || '');
  const token = String(query?.['hub.verify_token'] || '');
  const challenge = String(query?.['hub.challenge'] || '');
  const expected = String(process.env.VOM_WHATSAPP_VERIFY_TOKEN || '');
  return mode === 'subscribe' && Boolean(expected) && token === expected ? challenge : null;
}

function inboundMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const message of change?.value?.messages || []) {
        messages.push(message);
      }
    }
  }
  return messages;
}

function inboundSeenRecently(providerId) {
  const now = Date.now();
  if (recentInboundMessages.size > 1000) {
    for (const [key, timestamp] of recentInboundMessages) {
      if (now - timestamp > 24 * 60 * 60 * 1000) recentInboundMessages.delete(key);
    }
  }
  if (recentInboundMessages.has(providerId)) return true;
  recentInboundMessages.set(providerId, now);
  return false;
}

async function handleInboundMessage(message) {
  const providerId = String(message?.id || '');
  const from = normalizePhone(message?.from);
  const body = String(message?.text?.body || '').trim();
  if (!providerId || !from) return { skipped: true, reason: 'invalid_message' };
  if (inboundSeenRecently(providerId)) return { skipped: true, reason: 'duplicate' };
  if (!authorisedNumbers().includes(from)) return { skipped: true, reason: 'unauthorised' };

  let responseText;
  const normalized = body.toLowerCase();
  if (/^(report|status|today|operations|ops|summary|full report)\b/.test(normalized)) {
    const snapshot = await collectOperationsSnapshot();
    responseText = renderHourlyReport(snapshot);
  } else {
    responseText = [
      'VOM • Voxel Veda Operations Monitor',
      '',
      'Send one of these commands:',
      '• report',
      '• status',
      '• today',
      '• operations',
      '',
      'Your number is authorised for operational summaries.'
    ].join('\n');
  }

  const sent = await sendWhatsAppText(from, responseText);
  return { skipped: false, responded: true, provider_message_id: sent.provider_message_id };
}

async function processWebhookPayload(payload) {
  const outcomes = [];
  for (const message of inboundMessages(payload)) {
    try {
      outcomes.push(await handleInboundMessage(message));
    } catch (error) {
      console.error(`VOM inbound message failed: ${error.code || error.message}`);
      outcomes.push({ skipped: false, responded: false, code: error.code || 'INBOUND_FAILED' });
    }
  }
  return outcomes;
}

const scheduler = backgroundJobService.createScheduler({
  jobKey: 'vom_whatsapp_hourly_report',
  description: 'Send Voxel Veda hourly operations report through WhatsApp',
  handler: processHourlyReports,
  enabled,
  intervalMs: () => Math.max(60000, Number(process.env.VOM_WHATSAPP_POLL_MS || 300000)),
  initialDelayMs: 30000,
  leaseMs: Number(process.env.VOM_WHATSAPP_LEASE_MS || 240000)
});

function startVomWhatsAppScheduler() {
  return scheduler.start();
}

function stopVomWhatsAppScheduler() {
  scheduler.stop();
}

module.exports = {
  authorisedNumbers,
  collectOperationsSnapshot,
  configured,
  enabled,
  handleInboundMessage,
  hourKey,
  inboundMessages,
  processHourlyReports,
  processWebhookPayload,
  recipients,
  renderHourlyReport,
  sendWhatsAppText,
  startVomWhatsAppScheduler,
  stopVomWhatsAppScheduler,
  verifyMetaSignature,
  verifyWebhookChallenge
};
