const path = require('node:path');
const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { logSecurityEvent } = require('../services/sessionService');

const ALLOWED_PHOTO_TYPES = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']]
]);

function normalizeMobile(value) {
  const mobile = String(value || '').trim();
  if (!mobile) return null;
  if (mobile.length > 30) throw new Error('Mobile number is too long');
  if (!/^[+()\-\s0-9]+$/.test(mobile)) throw new Error('Mobile number contains unsupported characters');
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('Enter a valid mobile number');
  return mobile.replace(/\s+/g, ' ');
}

function sanitizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Name is required');
  if (name.length > 120) throw new Error('Name must be 120 characters or less');
  return name;
}

function validPhotoSignature(file) {
  if (!file?.buffer?.length) return false;
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (file.mimetype === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return false;
}

function photoExtensionAllowed(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  return (ALLOWED_PHOTO_TYPES.get(file?.mimetype) || []).includes(ext);
}

exports.getMyProfile = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    const [[user]] = await pool.query(
      `SELECT u.id, u.user_uuid, u.employee_number, u.name, u.username, u.email, u.role,
              u.department, u.account_status, u.active,
              p.mobile_number, p.profile_photo_mime, p.profile_photo_size, p.profile_photo_updated_at
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND u.deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );
    if (!user) return res.status(404).json({ message: 'Profile not found' });

    return res.json({
      profile: {
        ...user,
        active: Number(user.active) !== 0,
        has_profile_photo: Boolean(user.profile_photo_mime),
        profile_photo_url: user.profile_photo_mime ? `/api/profile/photo?v=${encodeURIComponent(user.profile_photo_updated_at || Date.now())}` : null
      }
    });
  } catch (error) {
    console.error('getMyProfile error:', error.message);
    return res.status(500).json({ message: 'Unable to load profile', request_id: req.requestId || null });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    let name;
    let mobileNumber;
    try {
      name = sanitizeName(req.body.name);
      mobileNumber = normalizeMobile(req.body.mobile_number);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const [[beforeUser]] = await pool.query('SELECT name FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
    if (!beforeUser) return res.status(404).json({ message: 'Profile not found' });
    const [[beforeProfile]] = await pool.query('SELECT mobile_number FROM user_profiles WHERE user_id = ? LIMIT 1', [userId]);

    await pool.query('UPDATE users SET name = ? WHERE id = ? AND deleted_at IS NULL', [name, userId]);
    await pool.query(
      `INSERT INTO user_profiles (user_id, mobile_number)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE mobile_number = VALUES(mobile_number), updated_at = CURRENT_TIMESTAMP(3)`,
      [userId, mobileNumber]
    );

    await logAudit(pool, {
      actorId: userId,
      action: 'SELF_PROFILE_UPDATED',
      module: 'profile',
      recordType: 'user',
      recordId: userId,
      oldValue: { name: beforeUser.name, mobile_number: beforeProfile?.mobile_number || null },
      newValue: { name, mobile_number: mobileNumber },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return res.json({ message: 'Profile updated successfully', profile: { name, mobile_number: mobileNumber } });
  } catch (error) {
    console.error('updateMyProfile error:', error.message);
    return res.status(500).json({ message: 'Unable to update profile', request_id: req.requestId || null });
  }
};

exports.uploadMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });
    if (!req.file) return res.status(400).json({ message: 'Select or take a profile photo first' });
    if (!ALLOWED_PHOTO_TYPES.has(req.file.mimetype) || !photoExtensionAllowed(req.file) || !validPhotoSignature(req.file)) {
      return res.status(400).json({ message: 'Profile photo must be a genuine JPG, PNG or WebP image' });
    }

    await pool.query(
      `INSERT INTO user_profiles
       (user_id, profile_photo, profile_photo_mime, profile_photo_size, profile_photo_updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         profile_photo = VALUES(profile_photo),
         profile_photo_mime = VALUES(profile_photo_mime),
         profile_photo_size = VALUES(profile_photo_size),
         profile_photo_updated_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [userId, req.file.buffer, req.file.mimetype, req.file.size]
    );

    await logSecurityEvent({ actorId: userId, targetUserId: userId, eventType: 'PROFILE_PHOTO_UPDATED', req, metadata: { mime: req.file.mimetype, size: req.file.size } });
    return res.json({ message: 'Profile photo updated successfully', profile_photo_url: `/api/profile/photo?v=${Date.now()}` });
  } catch (error) {
    console.error('uploadMyProfilePhoto error:', error.message);
    return res.status(500).json({ message: 'Unable to update profile photo', request_id: req.requestId || null });
  }
};

exports.getMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).end();
    const [[photo]] = await pool.query(
      'SELECT profile_photo, profile_photo_mime, profile_photo_updated_at FROM user_profiles WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (!photo?.profile_photo || !photo.profile_photo_mime) return res.status(404).end();
    res.setHeader('Content-Type', photo.profile_photo_mime);
    res.setHeader('Content-Length', String(photo.profile_photo.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(photo.profile_photo);
  } catch (error) {
    console.error('getMyProfilePhoto error:', error.message);
    return res.status(500).end();
  }
};

exports.deleteMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });
    await pool.query(
      `UPDATE user_profiles
       SET profile_photo = NULL, profile_photo_mime = NULL, profile_photo_size = NULL,
           profile_photo_updated_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
       WHERE user_id = ?`,
      [userId]
    );
    await logSecurityEvent({ actorId: userId, targetUserId: userId, eventType: 'PROFILE_PHOTO_REMOVED', req });
    return res.json({ message: 'Profile photo removed' });
  } catch (error) {
    console.error('deleteMyProfilePhoto error:', error.message);
    return res.status(500).json({ message: 'Unable to remove profile photo', request_id: req.requestId || null });
  }
};
