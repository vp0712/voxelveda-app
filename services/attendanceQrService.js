'use strict';
const crypto = require('node:crypto');
const urls = require('../config/urls');
const PREFIX = 'VVATT1', WINDOW_SECONDS = 20;
function error(message,code='ATTENDANCE_QR_INVALID',statusCode=403) { return Object.assign(new Error(message),{code,statusCode,fields:{qr_proof:message},qr_required:true}); }
function secret() {
  const value = process.env.SHIFT_QR_SIGNING_KEY || (process.env.NODE_ENV === 'production' ? '' : process.env.JWT_SECRET);
  if (!value) throw error('Shift QR signing is not configured. Contact your administrator.','ATTENDANCE_QR_NOT_CONFIGURED',503);
  return value;
}
function siteId() {
  // A technical token audience, never an assertion of GPS or a roster location.
  const value = String(process.env.SHIFT_QR_SITE_ID || process.env.COMPANY_SITE_ID || new URL(urls.app).hostname).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value)) throw error('The configured shift QR site identifier is invalid.','ATTENDANCE_QR_SITE_NOT_CONFIGURED',503);
  return value;
}
function encode(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${PREFIX}.${payload}.${crypto.createHmac('sha256',secret()).update(`${PREFIX}.${payload}`).digest('base64url')}`;
}
function extract(value) {
  const text = String(value || '').trim();
  if (text.startsWith(`${PREFIX}.`)) return text;
  try { const url = new URL(text); if (url.origin !== urls.app) return ''; return url.searchParams.get('shift_qr_token') || url.searchParams.get('shift_qr') || ''; } catch { return ''; }
}
function decode(value,now=new Date()) {
  const token = extract(value); if (!token || token.length > 2000) throw error('Scan the current workplace QR code.');
  const parts = token.split('.'); if (parts.length !== 3 || parts[0] !== PREFIX) throw error('Scan the current workplace QR code.');
  const expected = crypto.createHmac('sha256',secret()).update(`${PREFIX}.${parts[1]}`).digest();
  let supplied,claims; try { supplied=Buffer.from(parts[2],'base64url'); claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')); } catch { throw error('This QR code is invalid. Scan it again.'); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw error('This QR code is invalid. Scan it again.');
  const current = Math.floor(now.getTime()/1000);
  if (!claims || claims.v !== 1 || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > current+2 || claims.exp <= current || claims.exp-claims.iat > 60) throw error('This QR code has expired. Scan the current code.','ATTENDANCE_QR_EXPIRED');
  if (claims.site_id !== siteId()) throw error('This QR code belongs to a different attendance site.','ATTENDANCE_QR_WRONG_SITE');
  return claims;
}
function createSiteToken(now=new Date()) {
  const current=Math.floor(now.getTime()/1000),expiry=(Math.floor(current/WINDOW_SECONDS)+2)*WINDOW_SECONDS;
  const claims={v:1,purpose:'ATTENDANCE_SITE',site_id:siteId(),iat:current,exp:expiry,user_id:null};
  const token=encode(claims);
  return {token,qr_data:token,site_id:claims.site_id,site_kind:'APPLICATION',expires_at:new Date(expiry*1000).toISOString(),expires_in_seconds:expiry-current,refresh_seconds:WINDOW_SECONDS,manual_bypass_enabled:false};
}
function validateSiteToken(token,now) {
  const claims=decode(token,now); if (claims.purpose !== 'ATTENDANCE_SITE' || claims.user_id !== null) throw error('Scan the workplace attendance QR code.','ATTENDANCE_QR_WRONG_PURPOSE'); return claims;
}
function createActionProof({userId,action,attendanceId=null,priorAttendanceId=null,siteToken,now=new Date()}) {
  validateSiteToken(siteToken,now);
  if (!['CHECK_IN','CHECK_OUT'].includes(action)) throw error('Choose check-in or check-out before scanning.','ATTENDANCE_QR_WRONG_PURPOSE',422);
  const current=Math.floor(now.getTime()/1000);
  const claims={v:1,purpose:action,site_id:siteId(),user_id:Number(userId),attendance_id:attendanceId,prior_attendance_id:priorAttendanceId,iat:current,exp:current+30,jti:crypto.randomUUID()};
  return {valid:true,action,attendance_id:attendanceId,qr_proof:encode(claims),expires_at:new Date(claims.exp*1000).toISOString(),site_id:claims.site_id,site_kind:'APPLICATION',server_time:now.toISOString()};
}
function validateActionProof({token,userId,action,attendanceId=null,now=new Date()}) {
  const claims=decode(token,now);
  if (claims.purpose !== action) throw error('This scanned proof is for a different action. Scan again after selecting your action.','ATTENDANCE_QR_WRONG_PURPOSE');
  if (Number(claims.user_id) !== Number(userId)) throw error('This scanned proof belongs to another staff account.','ATTENDANCE_QR_WRONG_USER');
  if (action === 'CHECK_OUT' && Number(claims.attendance_id) !== Number(attendanceId)) throw error('This scanned proof belongs to a different shift. Refresh and scan again.','ATTENDANCE_QR_WRONG_SESSION');
  return claims;
}
module.exports={createSiteToken,validateSiteToken,createActionProof,validateActionProof,siteId,WINDOW_SECONDS};
