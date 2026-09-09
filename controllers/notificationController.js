const pool = require('../config/db');
const { ensureNotificationSchema } = require('../services/notificationSchema');
const { NOTIFICATION_CATEGORIES, normaliseCategory } = require('../services/notificationService');
const { findActiveTrashItem, moveToTrash, restoreTrashItem, TrashError } = require('../services/trashService');

function activeNotificationWhere(respectPreferences = false) {
  const base = 'user_id = ? AND deleted_at IS NULL AND dismissed_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())';
  if (!respectPreferences) return base;
  return `${base} AND NOT EXISTS (
    SELECT 1 FROM notification_preferences np
    WHERE np.user_id = notifications.user_id
      AND UPPER(np.category) = UPPER(notifications.category)
      AND np.in_app_enabled = 0
  )`;
}

function respondError(res, error) {
  if (error instanceof TrashError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
  console.error('NOTIFICATION API ERROR:', error);
  return res.status(500).json({ message: 'Notification operation failed' });
}

exports.list = async (req, res) => {
  try {
    await ensureNotificationSchema();
    const userId = Number(req.user.id);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const offset = (page - 1) * limit;
    const where = [activeNotificationWhere(true)];
    const params = [userId];
    const tab = String(req.query.tab || 'all').toLowerCase();
    const category = String(req.query.category || '').toUpperCase();
    const priority = String(req.query.priority || '').toUpperCase();

    if (tab === 'unread') where.push('is_read = 0');
    if (tab === 'important') where.push("UPPER(priority) IN ('HIGH', 'CRITICAL')");
    if (NOTIFICATION_CATEGORIES.has(category)) { where.push('UPPER(category) = ?'); params.push(category); }
    if (['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(priority)) { where.push('UPPER(priority) = ?'); params.push(priority); }

    const whereSql = where.join(' AND ');
    const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${whereSql}`, params);
    const [notifications] = await pool.query(
      `SELECT id, type, category, title, message, priority, linked_module, linked_record_id,
              action_url, is_read, read_at, expires_at, created_at
       FROM notifications
       WHERE ${whereSql}
       ORDER BY FIELD(UPPER(priority), 'CRITICAL', 'HIGH', 'NORMAL', 'LOW'), created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return res.json({
      notifications,
      page,
      limit,
      total: Number(countRow?.total || 0),
      pages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit))
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.unreadCount = async (req, res) => {
  try {
    await ensureNotificationSchema();
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS unread FROM notifications WHERE ${activeNotificationWhere(true)} AND is_read = 0`,
      [Number(req.user.id)]
    );
    return res.json({ unread: Number(row?.unread || 0) });
  } catch (error) {
    return respondError(res, error);
  }
};

async function setReadState(req, res, isRead) {
  try {
    await ensureNotificationSchema();
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Notification ID is required' });
    const [result] = await pool.query(
      `UPDATE notifications SET is_read = ?, read_at = ${isRead ? 'NOW()' : 'NULL'}
       WHERE id = ? AND ${activeNotificationWhere()}`,
      [isRead ? 1 : 0, id, Number(req.user.id)]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found' });
    return res.json({ message: isRead ? 'Notification marked as read' : 'Notification marked as unread' });
  } catch (error) {
    return respondError(res, error);
  }
}

exports.markRead = (req, res) => setReadState(req, res, true);
exports.markUnread = (req, res) => setReadState(req, res, false);

exports.markAllRead = async (req, res) => {
  try {
    await ensureNotificationSchema();
    const [result] = await pool.query(
      `UPDATE notifications SET is_read = 1, read_at = NOW()
       WHERE ${activeNotificationWhere()} AND is_read = 0`,
      [Number(req.user.id)]
    );
    return res.json({ message: 'All notifications marked as read', updated: result.affectedRows });
  } catch (error) {
    return respondError(res, error);
  }
};

async function deleteNotificationById(id, req, reason) {
  return moveToTrash({
    entityType: 'notification',
    entityId: id,
    actorId: req.user.id,
    reason,
    req,
    authorize: (record) => Number(record.user_id) === Number(req.user.id)
  });
}

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Notification ID is required' });
    const result = await deleteNotificationById(id, req, req.body.reason || 'Removed from Notification Centre');
    return res.json({ message: 'Notification moved to Trash', undo_available: true, ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

async function clearNotifications(req, res, readOnly) {
  try {
    await ensureNotificationSchema();
    const params = [Number(req.user.id)];
    const [rows] = await pool.query(
      `SELECT id FROM notifications WHERE ${activeNotificationWhere()}${readOnly ? ' AND is_read = 1' : ''}
       ORDER BY id ASC LIMIT 500`,
      params
    );
    let deleted = 0;
    const deletedIds = [];
    const failed = [];
    for (const row of rows) {
      try {
        await deleteNotificationById(row.id, req, readOnly ? 'Cleared read notification' : 'Cleared notification');
        deleted += 1;
        deletedIds.push(row.id);
      } catch (error) {
        failed.push({ id: row.id, code: error.code || 'NOTIFICATION_DELETE_FAILED' });
      }
    }
    return res.status(failed.length ? 207 : 200).json({ message: `${deleted} notification(s) moved to Trash`, deleted, deleted_ids: deletedIds, failed });
  } catch (error) {
    return respondError(res, error);
  }
}

exports.clearRead = (req, res) => clearNotifications(req, res, true);
exports.clearAll = (req, res) => clearNotifications(req, res, false);

exports.restore = async (req, res) => {
  try {
    const notificationId = Number(req.params.id);
    if (!notificationId) return res.status(400).json({ message: 'Notification ID is required' });
    const item = await findActiveTrashItem('notification', notificationId, req.user.id);
    if (!item) return res.status(404).json({ message: 'Deleted notification not found in Trash' });
    const result = await restoreTrashItem(item.id, { user: req.user, organisationWide: false, actorId: req.user.id, req });
    return res.json({ message: 'Notification restored', ...result });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.getPreferences = async (req, res) => {
  try {
    await ensureNotificationSchema();
    const [preferences] = await pool.query(
      `SELECT category, in_app_enabled, email_enabled, push_enabled,
              quiet_hours_start, quiet_hours_end, digest_frequency
       FROM notification_preferences WHERE user_id = ? ORDER BY category`,
      [Number(req.user.id)]
    );
    return res.json({ preferences });
  } catch (error) {
    return respondError(res, error);
  }
};

function booleanValue(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function validTime(value) {
  if (value == null || value === '') return null;
  const clean = String(value).trim();
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clean) ? clean : undefined;
}

exports.updatePreference = async (req, res) => {
  try {
    await ensureNotificationSchema();
    const category = normaliseCategory(req.body.category);
    const quietStart = validTime(req.body.quiet_hours_start);
    const quietEnd = validTime(req.body.quiet_hours_end);
    const digest = String(req.body.digest_frequency || 'IMMEDIATE').toUpperCase();
    if (quietStart === undefined || quietEnd === undefined) return res.status(400).json({ message: 'Quiet hours must use HH:MM format' });
    if (!['IMMEDIATE', 'DAILY', 'WEEKLY', 'OFF'].includes(digest)) return res.status(400).json({ message: 'Invalid digest frequency' });

    await pool.query(
      `INSERT INTO notification_preferences
       (user_id, category, in_app_enabled, email_enabled, push_enabled, quiet_hours_start, quiet_hours_end, digest_frequency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         in_app_enabled = VALUES(in_app_enabled), email_enabled = VALUES(email_enabled),
         push_enabled = VALUES(push_enabled), quiet_hours_start = VALUES(quiet_hours_start),
         quiet_hours_end = VALUES(quiet_hours_end), digest_frequency = VALUES(digest_frequency)`,
      [
        Number(req.user.id),
        category,
        booleanValue(req.body.in_app_enabled, 1),
        booleanValue(req.body.email_enabled, 0),
        booleanValue(req.body.push_enabled, 0),
        quietStart,
        quietEnd,
        digest
      ]
    );
    return res.json({ message: 'Notification preference saved', category });
  } catch (error) {
    return respondError(res, error);
  }
};
