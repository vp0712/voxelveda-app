const pool = require('../config/db');

function parseIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function ensureMeetingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      meeting_type VARCHAR(80) NOT NULL DEFAULT 'internal',
      organisation VARCHAR(255) NULL,
      contact_person VARCHAR(255) NULL,
      contact_details VARCHAR(255) NULL,
      location_type VARCHAR(80) NOT NULL DEFAULT 'site',
      location_details TEXT NULL,
      meeting_date DATE NOT NULL,
      meeting_time TIME NOT NULL,
      agenda TEXT NULL,
      required_preparation TEXT NULL,
      assigned_user_ids TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'scheduled',
      created_by INT NULL,
      updated_by INT NULL,
      deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_meeting_date (meeting_date),
      INDEX idx_meeting_status (status),
      INDEX idx_meeting_deleted (deleted)
    )
  `);
}

function normalizeMeeting(row) {
  return {
    ...row,
    assigned_user_ids: parseIds(row.assigned_user_ids)
  };
}

exports.listMeetings = async (req, res) => {
  try {
    await ensureMeetingTable();

    const [rows] = await pool.query(`
      SELECT
        m.*,
        creator.name AS created_by_name,
        updater.name AS updated_by_name
      FROM meetings m
      LEFT JOIN users creator ON creator.id = m.created_by
      LEFT JOIN users updater ON updater.id = m.updated_by
      WHERE m.deleted = 0
      ORDER BY m.meeting_date ASC, m.meeting_time ASC, m.id DESC
    `);

    res.json({ meetings: rows.map(normalizeMeeting) });
  } catch (err) {
    console.error('LIST MEETINGS ERROR:', err);
    res.status(500).json({ message: 'Failed to load meetings', error: err.message });
  }
};

exports.listMyMeetings = async (req, res) => {
  try {
    await ensureMeetingTable();

    const userId = Number(req.user?.id);
    const today = new Date().toISOString().slice(0, 10);

    const [rows] = await pool.query(`
      SELECT
        m.*,
        creator.name AS created_by_name
      FROM meetings m
      LEFT JOIN users creator ON creator.id = m.created_by
      WHERE m.deleted = 0
      AND m.status IN ('scheduled', 'confirmed')
      AND m.meeting_date >= ?
      ORDER BY m.meeting_date ASC, m.meeting_time ASC, m.id DESC
    `, [today]);

    const visible = rows
      .map(normalizeMeeting)
      .filter((row) => row.assigned_user_ids.includes(userId));

    res.json({ meetings: visible });
  } catch (err) {
    console.error('LIST MY MEETINGS ERROR:', err);
    res.status(500).json({ message: 'Failed to load your meetings', error: err.message });
  }
};

exports.saveMeeting = async (req, res) => {
  try {
    await ensureMeetingTable();

    const id = Number(req.body.id || 0);
    const title = String(req.body.title || '').trim();
    const meetingType = String(req.body.meeting_type || 'internal').trim();
    const organisation = String(req.body.organisation || '').trim();
    const contactPerson = String(req.body.contact_person || '').trim();
    const contactDetails = String(req.body.contact_details || '').trim();
    const locationType = String(req.body.location_type || 'site').trim();
    const locationDetails = String(req.body.location_details || '').trim();
    const meetingDate = String(req.body.meeting_date || '').trim();
    const meetingTime = String(req.body.meeting_time || '').trim();
    const agenda = String(req.body.agenda || '').trim();
    const requiredPreparation = String(req.body.required_preparation || '').trim();
    const assignedUserIds = parseIds(req.body.assigned_user_ids);
    const status = String(req.body.status || 'scheduled').trim();

    if (!title || !meetingDate || !meetingTime || !assignedUserIds.length) {
      return res.status(400).json({ message: 'Title, date, time and at least one attendee are required' });
    }

    if (id) {
      const [result] = await pool.query(`
        UPDATE meetings
        SET title = ?,
            meeting_type = ?,
            organisation = ?,
            contact_person = ?,
            contact_details = ?,
            location_type = ?,
            location_details = ?,
            meeting_date = ?,
            meeting_time = ?,
            agenda = ?,
            required_preparation = ?,
            assigned_user_ids = ?,
            status = ?,
            updated_by = ?
        WHERE id = ? AND deleted = 0
      `, [
        title, meetingType, organisation, contactPerson, contactDetails,
        locationType, locationDetails, meetingDate, meetingTime, agenda,
        requiredPreparation, JSON.stringify(assignedUserIds), status, req.user.id, id
      ]);

      if (result.affectedRows === 0) return res.status(404).json({ message: 'Meeting not found' });
      return res.json({ message: 'Meeting updated successfully' });
    }

    const [result] = await pool.query(`
      INSERT INTO meetings
        (title, meeting_type, organisation, contact_person, contact_details,
         location_type, location_details, meeting_date, meeting_time, agenda,
         required_preparation, assigned_user_ids, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      title, meetingType, organisation, contactPerson, contactDetails,
      locationType, locationDetails, meetingDate, meetingTime, agenda,
      requiredPreparation, JSON.stringify(assignedUserIds), status, req.user.id, req.user.id
    ]);

    res.json({ message: 'Meeting scheduled successfully', meeting_id: result.insertId });
  } catch (err) {
    console.error('SAVE MEETING ERROR:', err);
    res.status(500).json({ message: 'Meeting save failed', error: err.message });
  }
};

exports.deleteMeeting = async (req, res) => {
  try {
    await ensureMeetingTable();

    const id = Number(req.body.id || req.params.id);
    if (!id) return res.status(400).json({ message: 'Meeting ID is required' });

    const [result] = await pool.query(
      'UPDATE meetings SET deleted = 1, updated_by = ? WHERE id = ?',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ message: 'Meeting not found' });
    res.json({ message: 'Meeting removed successfully' });
  } catch (err) {
    console.error('DELETE MEETING ERROR:', err);
    res.status(500).json({ message: 'Meeting delete failed', error: err.message });
  }
};
