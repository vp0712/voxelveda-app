const pool = require('../config/db');

function isAdmin(req) {
  return String(req.user?.role || '').trim().toLowerCase() === 'admin';
}

async function ensureAnnouncementTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      priority VARCHAR(40) NOT NULL DEFAULT 'normal',
      starts_at DATE NOT NULL,
      expires_at DATE NOT NULL,
      audience_type VARCHAR(40) NOT NULL DEFAULT 'selected',
      target_user_ids TEXT NULL,
      created_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

function parseTargetUsers(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/* ================= GET ALL TASKS - ADMIN ================= */

exports.getTasks = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const [rows] = await pool.query(`
      SELECT
        t.*,
        u.name AS staff_name,
        u.email AS staff_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE IFNULL(t.deleted, 0) = 0
      ORDER BY
        CASE WHEN LOWER(t.status) = 'done' THEN 2 ELSE 1 END,
        t.due_date ASC,
        t.id DESC
    `);

    res.json({ tasks: rows });
  } catch (err) {
    console.error('GET TASKS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load tasks', error: err.message });
  }
};

/* ================= GET MY TASKS - STAFF ================= */

exports.getMyTasks = async (req, res) => {
  try {
    const userId = Number(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized user' });
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM tasks
      WHERE assigned_to = ?
      AND IFNULL(deleted, 0) = 0
      ORDER BY
        CASE WHEN LOWER(status) = 'done' THEN 2 ELSE 1 END,
        due_date ASC,
        id DESC
      `,
      [userId]
    );

    res.json({ tasks: rows });
  } catch (err) {
    console.error('GET MY TASKS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load my tasks', error: err.message });
  }
};

/* ================= CREATE TASK ================= */

exports.createTask = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const assignedTo = Number(req.body.assigned_to);
    const assignedBy = Number(req.user.id);
    const priority = String(req.body.priority || 'medium').trim().toLowerCase();
    const dueDate = String(req.body.due_date || '').slice(0, 10);

    if (!title || !description || !assignedTo || !dueDate) {
      return res.status(400).json({
        message: 'Task title, description, staff and due date are required'
      });
    }

    const [staffRows] = await pool.query(
      `
      SELECT id, name, email, role
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [assignedTo]
    );

    if (!staffRows.length) {
      return res.status(404).json({ message: 'Assigned staff user not found' });
    }

    if (String(staffRows[0].role || '').toLowerCase() === 'admin') {
      return res.status(400).json({ message: 'Cannot assign staff task to admin user' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO tasks
      (
        title,
        description,
        assigned_to,
        assigned_by,
        priority,
        status,
        due_date,
        deleted,
        started_at,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
      [
        title,
        description,
        assignedTo,
        assignedBy,
        priority,
        'pending',
        dueDate,
        0
      ]
    );

    const [[createdTask]] = await pool.query(
      `
      SELECT
        t.*,
        u.name AS staff_name,
        u.email AS staff_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.id = ?
      LIMIT 1
      `,
      [result.insertId]
    );

    res.json({
      message: 'Task assigned successfully',
      task_id: result.insertId,
      task: createdTask
    });
  } catch (err) {
    console.error('CREATE TASK ERROR FULL:', err);
    res.status(500).json({ message: 'Task creation failed', error: err.message });
  }
};

/* ================= UPDATE TASK STATUS ================= */

exports.updateTaskStatus = async (req, res) => {
  try {
    const taskId = Number(req.body.task_id);
    const status = String(req.body.status || '').trim().toLowerCase();

    if (!taskId || !status) {
      return res.status(400).json({ message: 'Task ID and status are required' });
    }

    const allowed = ['pending', 'in_progress', 'done'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid task status' });
    }

    const [taskRows] = await pool.query(
      `
      SELECT *
      FROM tasks
      WHERE id = ?
      AND IFNULL(deleted, 0) = 0
      LIMIT 1
      `,
      [taskId]
    );

    if (!taskRows.length) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const task = taskRows[0];

    if (!isAdmin(req) && Number(task.assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'You cannot update this task' });
    }

    let sql = '';
    let params = [];

    if (status === 'in_progress') {
      sql = `
        UPDATE tasks
        SET status = ?,
            started_at = IFNULL(started_at, NOW()),
            completed_at = NULL
        WHERE id = ?
      `;
      params = [status, taskId];
    } else if (status === 'done') {
      sql = `
        UPDATE tasks
        SET status = ?,
            started_at = IFNULL(started_at, NOW()),
            completed_at = NOW()
        WHERE id = ?
      `;
      params = [status, taskId];
    } else {
      sql = `
        UPDATE tasks
        SET status = ?,
            completed_at = NULL
        WHERE id = ?
      `;
      params = [status, taskId];
    }

    await pool.query(sql, params);

    res.json({ message: 'Task status updated successfully' });
  } catch (err) {
    console.error('UPDATE TASK ERROR FULL:', err);
    res.status(500).json({ message: 'Task update failed', error: err.message });
  }
};

/* ================= DELETE TASK ================= */

exports.deleteTask = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    const taskId = Number(req.body.task_id);

    if (!taskId) {
      return res.status(400).json({ message: 'Task ID is required' });
    }

    const [result] = await pool.query(
      `
      UPDATE tasks
      SET deleted = 1
      WHERE id = ?
      `,
      [taskId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('DELETE TASK ERROR FULL:', err);
    res.status(500).json({ message: 'Task delete failed', error: err.message });
  }
};

/* ================= ANNOUNCEMENTS ================= */

exports.getAnnouncements = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    await ensureAnnouncementTable();

    const [rows] = await pool.query(`
      SELECT
        a.*,
        u.name AS created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.deleted = 0
      ORDER BY a.expires_at DESC, a.id DESC
    `);

    res.json({
      announcements: rows.map((row) => ({
        ...row,
        target_user_ids: parseTargetUsers(row.target_user_ids)
      }))
    });
  } catch (err) {
    console.error('GET ANNOUNCEMENTS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load announcements', error: err.message });
  }
};

exports.getMyAnnouncements = async (req, res) => {
  try {
    await ensureAnnouncementTable();

    const userId = Number(req.user?.id);
    const today = new Date().toISOString().slice(0, 10);

    const [rows] = await pool.query(
      `
      SELECT
        a.*,
        u.name AS created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.deleted = 0
      AND a.starts_at <= ?
      AND a.expires_at >= ?
      ORDER BY
        CASE a.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        a.expires_at ASC,
        a.id DESC
      `,
      [today, today]
    );

    const visible = rows
      .map((row) => ({ ...row, target_user_ids: parseTargetUsers(row.target_user_ids) }))
      .filter((row) => row.audience_type === 'all' || row.target_user_ids.includes(userId));

    res.json({ announcements: visible });
  } catch (err) {
    console.error('GET MY ANNOUNCEMENTS ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load announcements', error: err.message });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    await ensureAnnouncementTable();

    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();
    const startsAt = String(req.body.starts_at || '').slice(0, 10);
    const expiresAt = String(req.body.expires_at || '').slice(0, 10);
    const audienceType = String(req.body.audience_type || 'selected').trim().toLowerCase() === 'all' ? 'all' : 'selected';
    const targetUserIds = parseTargetUsers(req.body.target_user_ids);

    if (!title || !message || !startsAt || !expiresAt) {
      return res.status(400).json({ message: 'Title, message, start date, and expiry date are required' });
    }

    if (!['normal', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ message: 'Invalid announcement priority' });
    }

    if (expiresAt < startsAt) {
      return res.status(400).json({ message: 'Expiry date cannot be before start date' });
    }

    if (audienceType === 'selected' && targetUserIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one staff member or choose everyone' });
    }

    const [result] = await pool.query(
      `
      INSERT INTO announcements
      (title, message, priority, starts_at, expires_at, audience_type, target_user_ids, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        title,
        message,
        priority,
        startsAt,
        expiresAt,
        audienceType,
        JSON.stringify(targetUserIds),
        req.user.id
      ]
    );

    res.json({ message: 'Announcement published successfully', announcement_id: result.insertId });
  } catch (err) {
    console.error('CREATE ANNOUNCEMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Announcement creation failed', error: err.message });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: 'Admin only' });
    }

    await ensureAnnouncementTable();

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Announcement ID is required' });

    const [result] = await pool.query(
      'UPDATE announcements SET deleted = 1 WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Announcement not found' });
    res.json({ message: 'Announcement removed successfully' });
  } catch (err) {
    console.error('DELETE ANNOUNCEMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Announcement delete failed', error: err.message });
  }
};
