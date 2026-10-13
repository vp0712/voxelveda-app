const pool = require('../config/db');
const { logAudit } = require('../services/auditService');
const { logSecurityEvent } = require('../services/sessionService');
const { ensureHrAdministrationSchema } = require('../services/hrAdministrationSchema');
const { ensureSecurityGovernanceSchema } = require('../services/securityGovernanceSchema');
const { normalizeTimesheetDeliveryEmail } = require('../services/timesheetDeliveryPreferenceService');
const photoService = require('../services/profilePhotoService');
const { hasPermission, canAccessUserRecord } = require('../services/authorizationService');
const { customerScoped } = require('../services/customerRecordScope');

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

exports.getMyProfile = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });
    await ensureHrAdministrationSchema();
    await photoService.ensureProfilePhotoSchema();

    const [[user]] = await pool.query(
      `SELECT u.id, u.user_uuid, u.name, u.username, u.email, u.role, u.timesheet_delivery_email,
              u.account_status, u.active,
              p.mobile_number, p.profile_photo_mime, p.profile_photo_size, p.profile_photo_updated_at, p.profile_photo_sha256,
              p.updated_at AS profile_updated_at
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND u.deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );
    if (!user) return res.status(404).json({ message: 'Profile not found' });

    return res.json({
      profile: {
        id: user.id, user_uuid: user.user_uuid, name: user.name, username: user.username, email: user.email, role: user.role,
        account_status: user.account_status, mobile_number: user.mobile_number,
        timesheet_delivery_email: user.timesheet_delivery_email || null,
        profile_photo_mime: user.profile_photo_mime, profile_photo_size: user.profile_photo_size,
        profile_photo_revision: user.profile_photo_sha256 || user.profile_photo_updated_at || null,
        profile_photo_updated_at: user.profile_photo_updated_at, profile_updated_at: user.profile_updated_at,
        active: Number(user.active) !== 0,
        has_profile_photo: Boolean(user.profile_photo_mime),
        profile_photo_url: user.profile_photo_mime ? `/api/profile/photo?v=${encodeURIComponent(user.profile_photo_sha256 || user.profile_photo_updated_at || 'legacy')}` : null
      }
    });
  } catch (error) {
    console.error('getMyProfile error:', error.message);
    return res.status(500).json({ message: 'Unable to load profile', request_id: req.requestId || null });
  }
};

exports.updateMyProfile = async (req, res) => {
  let connection;
  let committed = false;
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });

    let name;
    let mobileNumber;
    let designatedEmail;
    try {
      name = sanitizeName(req.body.name);
      mobileNumber = normalizeMobile(req.body.mobile_number);
      if (Object.hasOwn(req.body, 'timesheet_delivery_email')) designatedEmail = normalizeTimesheetDeliveryEmail(req.body.timesheet_delivery_email);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message, code: validationError.code, fields: validationError.fields });
    }

    await ensureHrAdministrationSchema();
    await ensureSecurityGovernanceSchema();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    // Lock the account before its preferences, matching the delivery worker's
    // lock order. An already completed delivery keeps its original recipient.
    const [[beforeUser]] = await connection.query('SELECT name, timesheet_delivery_email FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE', [userId]);
    if (!beforeUser) return res.status(404).json({ message: 'Profile not found' });
    const [[beforeProfile]] = await connection.query('SELECT mobile_number FROM user_profiles WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId]);
    if (designatedEmail === undefined) designatedEmail = beforeUser.timesheet_delivery_email || null;
    if (name === beforeUser.name && mobileNumber === (beforeProfile?.mobile_number || null)
        && designatedEmail === (beforeUser.timesheet_delivery_email || null)) {
      await connection.commit();
      committed = true;
      return res.json({ message: 'Profile is already up to date', unchanged: true, profile: { name, mobile_number: mobileNumber, timesheet_delivery_email: designatedEmail } });
    }

    await connection.query('UPDATE users SET name = ?, timesheet_delivery_email = ? WHERE id = ? AND deleted_at IS NULL', [name, designatedEmail, userId]);
    await connection.query(
      `INSERT INTO user_profiles (user_id, mobile_number)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE mobile_number = VALUES(mobile_number), updated_at = CURRENT_TIMESTAMP(3)`,
      [userId, mobileNumber]
    );

    await logAudit(connection, {
      actorId: userId,
      action: 'SELF_PROFILE_UPDATED',
      module: 'profile',
      recordType: 'user',
      recordId: userId,
      oldValue: { name: beforeUser.name, mobile_number: beforeProfile?.mobile_number || null, timesheet_delivery_email: beforeUser.timesheet_delivery_email || null },
      newValue: { name, mobile_number: mobileNumber, timesheet_delivery_email: designatedEmail },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    await connection.commit();
    committed = true;

    return res.json({ message: 'Profile updated successfully', profile: { name, mobile_number: mobileNumber, timesheet_delivery_email: designatedEmail } });
  } catch (error) {
    console.error('updateMyProfile error:', error.message);
    return res.status(500).json({ message: 'Unable to update profile', request_id: req.requestId || null });
  } finally {
    if (connection) {
      if (!committed) await connection.rollback().catch(() => {});
      connection.release();
    }
  }
};

exports.uploadMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });
    if (!req.file) return res.status(400).json({ message: 'Select or take a profile photo first' });
    const unsupported=Object.keys(req.body||{}).filter(key=>!['crop_x','crop_y','crop_zoom'].includes(key));
    if(unsupported.length)return res.status(400).json({message:'The photo request contains unsupported fields.',fields:{photo:'Upload your own photo with optional crop position only.'}});
    const photo=await photoService.saveProfilePhoto(userId,req.file,req,{x:req.body?.crop_x,y:req.body?.crop_y,zoom:req.body?.crop_zoom});
    if(!photo.unchanged)await logSecurityEvent({ actorId: userId, targetUserId: userId, eventType: 'PROFILE_PHOTO_UPDATED', req, metadata: { mime: photo.mime, size: photo.size } }).catch(error=>console.warn('PROFILE_PHOTO_EVENT_FAILED',error.code||'EVENT_UNAVAILABLE'));
    return res.json({ message: photo.unchanged?'Profile photo is already up to date':'Profile photo updated successfully',unchanged:Boolean(photo.unchanged),has_profile_photo:true,profile_photo_revision:photo.sha256,profile_photo_url:`/api/profile/photo?v=${encodeURIComponent(photo.sha256)}`,profile_photo_mime:photo.mime,profile_photo_size:photo.size,profile_photo_updated_at:photo.updatedAt||null });
  } catch (error) {
    console.error('uploadMyProfilePhoto error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.statusCode?error.message:'Unable to update profile photo. Your current photo remains available.',code:error.code || 'PROFILE_PHOTO_SAVE_FAILED',fields:error.fields, request_id: req.requestId || null });
  }
};

exports.getMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).end();
    return await sendPhoto(userId,res);
  } catch (error) {
    console.error('getMyProfilePhoto error:', error.message);
    return res.status(error.statusCode || 503).json({message:'Your profile photo could not be loaded. Retry shortly.',code:error.code || 'PROFILE_PHOTO_UNAVAILABLE'});
  }
};

exports.deleteMyProfilePhoto = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ message: 'Authentication required' });
    const result=await photoService.removeProfilePhoto(userId,req);
    if(!result.unchanged)await logSecurityEvent({ actorId: userId, targetUserId: userId, eventType: 'PROFILE_PHOTO_REMOVED', req }).catch(error=>console.warn('PROFILE_PHOTO_EVENT_FAILED',error.code||'EVENT_UNAVAILABLE'));
    return res.json({ message: 'Profile photo removed',has_profile_photo:false,profile_photo_url:null,profile_photo_revision:null,unchanged:result.unchanged });
  } catch (error) {
    console.error('deleteMyProfilePhoto error:', error.message);
    return res.status(500).json({ message: 'Unable to remove profile photo', request_id: req.requestId || null });
  }
};

async function sendPhoto(userId,res){
  const photo=await photoService.getProfilePhoto(userId);
  if(!photo)return res.status(404).json({message:'No profile photo is uploaded.',code:'PROFILE_PHOTO_NOT_FOUND'});
  res.setHeader('Content-Type',photo.mime);res.setHeader('Content-Length',String(photo.buffer.length));
  res.setHeader('Content-Disposition',`inline; filename="profile-photo.${photo.mime==='image/png'?'png':photo.mime==='image/webp'?'webp':'jpg'}"`);
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Cookie, Authorization');
  return res.send(photo.buffer);
}
async function mayViewStaffPhoto(actor,targetId,db=pool){
  if(!Number.isSafeInteger(Number(actor?.id))||!Number.isSafeInteger(targetId)||targetId<1)return false;
  if(Number(actor.id)===targetId)return true;
  if(customerScoped(actor)||['supplier','contractor','visitor'].includes(String(actor.role||'').toLowerCase()))return false;
  await ensureHrAdministrationSchema();
  const [[target]]=await db.query('SELECT id,role,department,manager_id FROM users WHERE id=? AND active=1 AND deleted_at IS NULL LIMIT 1',[targetId]);
  if(!target||customerScoped(target)||['supplier','contractor','visitor'].includes(String(target.role||'').toLowerCase()))return false;
  const [[account]]=await db.query('SELECT access_scope FROM users WHERE id=? AND active=1 AND deleted_at IS NULL LIMIT 1',[Number(actor.id)]);
  if(!account)return false;
  let scope={};try{scope=typeof account.access_scope==='object'&&account.access_scope!==null?account.access_scope:JSON.parse(account.access_scope||'{}');}catch{return false;}
  if(!scope || typeof scope!=='object' || Array.isArray(scope) || (scope.departments!==undefined && (!Array.isArray(scope.departments) || scope.departments.some(item=>typeof item!=='string'))))return false;
  if(Array.isArray(scope.departments)&&scope.departments.length&&!scope.departments.includes(target.department))return false;
  if(hasPermission(actor,'MANAGE_USERS')||hasPermission(actor,'VIEW_STAFF_HR'))return true;
  return canAccessUserRecord(actor,targetId,{team:'VIEW_TEAM_TIMESHEET',connection:db});
}
exports.getStaffProfilePhoto=async(req,res)=>{
  try{
    const id=Number(req.params.id);
    if(!await mayViewStaffPhoto(req.user,id))return res.status(404).json({message:'Staff photo is unavailable in your authorised scope.',code:'PROFILE_PHOTO_NOT_FOUND'});
    return await sendPhoto(id,res);
  }catch(error){return res.status(error.statusCode||503).json({message:'The staff photo could not be loaded. Retry shortly.',code:error.code||'PROFILE_PHOTO_UNAVAILABLE'});}
};
exports._test={mayViewStaffPhoto};
