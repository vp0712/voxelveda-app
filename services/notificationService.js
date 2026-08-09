async function createNotification(db, notification) {
  const [result] = await db.query(
    `
    INSERT INTO notifications
    (user_id, type, title, message, priority, linked_module, linked_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      notification.userId,
      notification.type,
      notification.title,
      notification.message || null,
      notification.priority || 'normal',
      notification.linkedModule || null,
      notification.linkedRecordId ? String(notification.linkedRecordId) : null
    ]
  );
  return result.insertId;
}

module.exports = { createNotification };
