const { ensureNotificationSchema } = require('./notificationSchema');

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
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  return url.slice(0, 500);
}

async function createNotification(db, notification) {
  await ensureNotificationSchema();
  const userId = Number(notification.userId);
  const title = String(notification.title || '').trim();
  const type = String(notification.type || 'system').trim().slice(0, 80);
  if (!userId || !title) throw new Error('Notification user and title are required');

  const [result] = await db.query(
    `INSERT INTO notifications
     (user_id, type, category, title, message, priority, linked_module,
      linked_record_id, action_url, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      notification.expiresAt || null
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
