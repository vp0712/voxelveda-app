const crypto = require('node:crypto');
const { ensureNotificationSchema } = require('./notificationSchema');
const { retiredRequest, retiredAsset } = require('./applicationRetirement');

const NOTIFICATION_CATEGORIES = new Set(['FINANCE', 'PRODUCTION', 'QUALITY', 'SECURITY', 'HR', 'TASKS', 'SYSTEM']);
const NOTIFICATION_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

function normaliseCategory(value) {
  const category = String(value || 'SYSTEM').trim().toUpperCase();
  return NOTIFICATION_CATEGORIES.has(category) ? category : 'SYSTEM';
}

function normalisePriority(value) {
  const priority = String(value || 'NORMAL').trim().toUpperCase();
  return NOTIFICATION_PRIORITIES.has(priority) ? priority : 'NORMAL';
}

function normaliseActionUrl(value) {
  const url = String(value || '').trim();
  if (!url || url.length > 500 || !url.startsWith('/') || url.startsWith('//') || /[\\\x00-\x20\x7f]/.test(url)) return null;
  try {
    const parsed = new URL(url, 'https://app.voxelveda.com');
    if (parsed.origin !== 'https://app.voxelveda.com') return null;
    const path = decodeURIComponent(parsed.pathname).toLowerCase();
    if (/[\\\x00-\x20\x7f]/.test(path) || /%[0-9a-f]{2}/i.test(path) || /%2f/i.test(parsed.pathname)) return null;
    if (retiredRequest(path) || retiredAsset(path) || /^\/(?:personal-finance|financial-years)(?:[/.]|$)/.test(path)) return null;
    const view = String(parsed.searchParams.get('view') || '').toLowerCase();
    if (/^(?:finance|banking|erp|personal-finance|financial-years)(?:[-_]|$)/.test(view)) return null;
  } catch { return null; }
  return url.slice(0, 500);
}

async function createNotification(db, notification) {
  await ensureNotificationSchema();
  const userId = Number(notification.userId);
  const title = String(notification.title || '').trim();
  const type = String(notification.type || 'system').trim().slice(0, 80);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !title) throw new Error('Notification user and title are required');
  if (['FINANCE','BANKING','ERP','PERSONAL_FINANCE'].includes(String(notification.linkedModule || '').toUpperCase())) throw Object.assign(new Error('Retired module notifications are disabled.'), { code: 'MODULE_RETIRED', status: 410 });

  const linkedIdentity = notification.linkedRecordId == null ? null : [type, notification.linkedModule || '', notification.linkedRecordId, title, notification.message || ''];
  const eventKey = notification.dedupeKey || linkedIdentity
    ? crypto.createHash('sha256').update(JSON.stringify([userId, notification.dedupeKey || linkedIdentity])).digest('hex') : null;
  const [result] = await db.query(
    `INSERT INTO notifications
     (user_id, type, category, title, message, priority, linked_module,
      linked_record_id, action_url, expires_at, event_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      userId,
      type,
      normaliseCategory(notification.category),
      title.slice(0, 180),
      notification.message ? String(notification.message).slice(0, 5000) : null,
      normalisePriority(notification.priority),
      notification.linkedModule ? String(notification.linkedModule).slice(0, 80) : null,
      notification.linkedRecordId == null ? null : String(notification.linkedRecordId).slice(0, 80),
      normaliseActionUrl(notification.actionUrl),
      notification.expiresAt || null,
      eventKey
    ]
  );
  return result.insertId;
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  createNotification,
  normaliseActionUrl,
  normaliseCategory,
  normalisePriority
};
