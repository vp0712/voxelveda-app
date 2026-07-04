const pool = require('../config/db');

function isAdmin(req) {
  return String(req.user?.role || '').trim().toLowerCase() === 'admin';
}

function parsePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function canManageTasks(req) {
  return isAdmin(req) || parsePermissions(req.user?.permissions).includes('tasks');
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

async function ensureTaskTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      description TEXT NULL,
      assigned_to INT NULL,
      assigned_by INT NULL,
      priority VARCHAR(40) NOT NULL DEFAULT 'medium',
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      due_date DATE NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tasks_assigned_to (assigned_to)
    )
  `);

  await pool.query(`ALTER TABLE tasks ADD COLUMN title VARCHAR(180) NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN description TEXT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN assigned_to INT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN assigned_by INT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN priority VARCHAR(40) NOT NULL DEFAULT 'medium'`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'pending'`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN due_date DATE NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN started_at DATETIME NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN completed_at DATETIME NULL`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE tasks ADD COLUMN updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP`).catch(() => {});
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
    await ensureTaskTables();

    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
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
        t.id ASC
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
    await ensureTaskTables();

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
        id ASC
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
    await ensureTaskTables();

    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
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

exports.getAssignableStaff = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    const [rows] = await pool.query(
      `
      SELECT id, name, username, email, role, active
      FROM users
      WHERE LOWER(role) <> 'admin'
      AND IFNULL(active, 1) = 1
      ORDER BY name ASC, email ASC
      `
    );

    res.json({ users: rows });
  } catch (err) {
    console.error('GET ASSIGNABLE STAFF ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load assignable staff', error: err.message });
  }
};

/* ================= UPDATE TASK DETAILS ================= */

exports.updateTask = async (req, res) => {
  try {
    await ensureTaskTables();

    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    const taskId = Number(req.body.task_id || req.body.id || 0);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const assignedTo = Number(req.body.assigned_to);
    const priority = String(req.body.priority || 'medium').trim().toLowerCase();
    const dueDate = String(req.body.due_date || '').slice(0, 10);
    const status = String(req.body.status || 'pending').trim().toLowerCase();

    if (!taskId || !title || !description || !assignedTo || !dueDate) {
      return res.status(400).json({ message: 'Task ID, title, description, staff and due date are required' });
    }

    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ message: 'Invalid task priority' });
    }

    if (!['pending', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ message: 'Invalid task status' });
    }

    const [staffRows] = await pool.query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [assignedTo]);
    if (!staffRows.length) return res.status(404).json({ message: 'Assigned staff user not found' });

    if (String(staffRows[0].role || '').toLowerCase() === 'admin') {
      return res.status(400).json({ message: 'Cannot assign staff task to admin user' });
    }

    const startedAtSql = status === 'pending' ? 'NULL' : 'IFNULL(started_at, NOW())';
    const completedAtSql = status === 'done' ? 'NOW()' : 'NULL';

    const [result] = await pool.query(
      `
      UPDATE tasks
      SET title = ?,
          description = ?,
          assigned_to = ?,
          priority = ?,
          due_date = ?,
          status = ?,
          started_at = ${startedAtSql},
          completed_at = ${completedAtSql}
      WHERE id = ?
      AND IFNULL(deleted, 0) = 0
      `,
      [title, description, assignedTo, priority, dueDate, status, taskId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Task not found' });
    res.json({ message: 'Task updated successfully' });
  } catch (err) {
    console.error('UPDATE TASK DETAILS ERROR FULL:', err);
    res.status(500).json({ message: 'Task update failed', error: err.message });
  }
};

/* ================= UPDATE TASK STATUS ================= */

exports.updateTaskStatus = async (req, res) => {
  try {
    await ensureTaskTables();

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
    await ensureTaskTables();

    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
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
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    await ensureAnnouncementTable();

    const [rows] = await pool.query(`
      SELECT
        a.*,
        u.name AS created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.deleted = 0
      ORDER BY a.expires_at ASC, a.id ASC
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
        a.id ASC
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
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
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

exports.updateAnnouncement = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    await ensureAnnouncementTable();

    const id = Number(req.body.id || 0);
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();
    const startsAt = String(req.body.starts_at || '').slice(0, 10);
    const expiresAt = String(req.body.expires_at || '').slice(0, 10);
    const audienceType = String(req.body.audience_type || 'selected').trim().toLowerCase() === 'all' ? 'all' : 'selected';
    const targetUserIds = parseTargetUsers(req.body.target_user_ids);

    if (!id || !title || !message || !startsAt || !expiresAt) {
      return res.status(400).json({ message: 'ID, title, message, start date, and expiry date are required' });
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
      UPDATE announcements
      SET title = ?,
          message = ?,
          priority = ?,
          starts_at = ?,
          expires_at = ?,
          audience_type = ?,
          target_user_ids = ?
      WHERE id = ?
      AND deleted = 0
      `,
      [title, message, priority, startsAt, expiresAt, audienceType, JSON.stringify(targetUserIds), id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Announcement not found' });
    res.json({ message: 'Announcement updated successfully' });
  } catch (err) {
    console.error('UPDATE ANNOUNCEMENT ERROR FULL:', err);
    res.status(500).json({ message: 'Announcement update failed', error: err.message });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
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

async function ensureStaffMessageTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      priority VARCHAR(40) NOT NULL DEFAULT 'Normal',
      body TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Open',
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by INT NULL,
      INDEX idx_staff_messages_user (user_id),
      INDEX idx_staff_messages_status (status),
      INDEX idx_staff_messages_deleted (deleted)
    )
  `);

  await pool.query(`ALTER TABLE staff_messages ADD COLUMN user_id INT NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN priority VARCHAR(40) NOT NULL DEFAULT 'Normal'`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN body TEXT NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'Open'`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN reviewed_at DATETIME NULL`).catch(() => {});
  await pool.query(`ALTER TABLE staff_messages ADD COLUMN reviewed_by INT NULL`).catch(() => {});
}

exports.getStaffMessages = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    await ensureStaffMessageTable();

    const [rows] = await pool.query(`
      SELECT
        sm.*,
        u.name AS staff_name,
        u.email AS staff_email,
        reviewer.name AS reviewed_by_name
      FROM staff_messages sm
      LEFT JOIN users u ON u.id = sm.user_id
      LEFT JOIN users reviewer ON reviewer.id = sm.reviewed_by
      WHERE IFNULL(sm.deleted, 0) = 0
      ORDER BY
        CASE WHEN LOWER(sm.status) IN ('open', 'new') THEN 1 ELSE 2 END,
        sm.id DESC
    `);

    res.json({ messages: rows });
  } catch (err) {
    console.error('GET STAFF MESSAGES ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load staff messages', error: err.message });
  }
};

exports.getMyStaffMessages = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ message: 'Unauthorized user' });

    await ensureStaffMessageTable();

    const [rows] = await pool.query(
      `SELECT * FROM staff_messages WHERE user_id = ? AND IFNULL(deleted, 0) = 0 ORDER BY id DESC`,
      [userId]
    );

    res.json({ messages: rows });
  } catch (err) {
    console.error('GET MY STAFF MESSAGES ERROR FULL:', err);
    res.status(500).json({ message: 'Failed to load your messages', error: err.message });
  }
};

exports.createStaffMessage = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) return res.status(401).json({ message: 'Unauthorized user' });

    const priority = String(req.body.priority || 'Normal').trim().slice(0, 40) || 'Normal';
    const body = String(req.body.body || '').trim();

    if (!body) return res.status(400).json({ message: 'Message is required' });
    if (body.length > 5000) return res.status(400).json({ message: 'Message is too long' });

    await ensureStaffMessageTable();

    const [result] = await pool.query(
      `INSERT INTO staff_messages (user_id, priority, body, status) VALUES (?, ?, ?, 'Open')`,
      [userId, priority, body]
    );

    res.json({ message: 'Message sent to admin successfully', message_id: result.insertId });
  } catch (err) {
    console.error('CREATE STAFF MESSAGE ERROR FULL:', err);
    res.status(500).json({ message: 'Message send failed', error: err.message });
  }
};

exports.updateStaffMessage = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    const id = Number(req.body.id || 0);
    const status = String(req.body.status || 'Reviewed').trim().slice(0, 40) || 'Reviewed';
    if (!id) return res.status(400).json({ message: 'Message ID is required' });

    await ensureStaffMessageTable();

    const [result] = await pool.query(
      `UPDATE staff_messages SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ? AND IFNULL(deleted, 0) = 0`,
      [status, req.user?.id || null, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Message not found' });
    res.json({ message: 'Message updated successfully' });
  } catch (err) {
    console.error('UPDATE STAFF MESSAGE ERROR FULL:', err);
    res.status(500).json({ message: 'Message update failed', error: err.message });
  }
};

exports.deleteStaffMessage = async (req, res) => {
  try {
    if (!canManageTasks(req)) {
      return res.status(403).json({ message: 'Task control access is not enabled for your account' });
    }

    const id = Number(req.body.id || 0);
    if (!id) return res.status(400).json({ message: 'Message ID is required' });

    await ensureStaffMessageTable();

    const [result] = await pool.query(
      `UPDATE staff_messages SET deleted = 1 WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Message not found' });
    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    console.error('DELETE STAFF MESSAGE ERROR FULL:', err);
    res.status(500).json({ message: 'Message delete failed', error: err.message });
  }
};