'use strict';
const crypto=require('node:crypto');
const pool=require('../config/db');
const qr=require('./attendanceQrService');
const {renderAttendanceQr}=require('./attendanceQrRenderer');
const {logAudit}=require('./auditService');
const urls=require('../config/urls');
const schemas=new WeakMap();
const TABLE=`CREATE TABLE IF NOT EXISTS attendance_display_links (
 id CHAR(36) PRIMARY KEY, site_id VARCHAR(120) NOT NULL, label VARCHAR(120) NOT NULL,
 credential_hash CHAR(64) NOT NULL, request_id CHAR(36) NULL, request_sha256 CHAR(64) NULL,
 revision INT NOT NULL DEFAULT 1, created_by INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at DATETIME NULL, revoked_by INT NULL, revoke_reason VARCHAR(1000) NULL,
 revoked_request_id CHAR(36) NULL, revoked_request_sha256 CHAR(64) NULL, replaced_by CHAR(36) NULL,
 UNIQUE KEY uniq_attendance_display_hash(credential_hash), UNIQUE KEY uniq_attendance_display_request(request_id),
 UNIQUE KEY uniq_attendance_display_revocation(revoked_request_id), INDEX idx_attendance_display_site(site_id,revoked_at)
) ENGINE=InnoDB`;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function fail(message,code='ATTENDANCE_DISPLAY_INVALID',statusCode=422){return Object.assign(new Error(message),{code,statusCode});}
function publicRecord(row){if(!row)return null;const {id,site_id,label,revision,created_by,created_at,revoked_at,revoked_by,revoke_reason,replaced_by}=row;return{id,site_id,label,revision:Number(revision),created_by,created_at,revoked_at,revoked_by,revoke_reason,replaced_by};}
function requestId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw fail('A stable request identifier is required.','ATTENDANCE_DISPLAY_REQUEST_REQUIRED');return value;}
function text(value,name,max=120,min=1){const s=String(value??'').trim();if(s.length<min||s.length>max)throw fail(`Enter a valid ${name}.`);return s;}
function revision(value,row){if(!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)!==Number(row.revision))throw fail('This display changed. Refresh before retrying.','ATTENDANCE_DISPLAY_REVISION_CONFLICT',409);}
function audit(db,user,action,row,oldValue,req,extra={}){return logAudit(db,{actorId:user?.id??null,action,module:'Attendance',recordType:'attendance_display_link',recordId:row.id,oldValue,newValue:{...publicRecord(row),...extra},ipAddress:req?.ip,userAgent:req?.get?.('user-agent'),metadata:{scope:'WORKPLACE_QR_DISPLAY_ONLY'}});}
async function transaction(db,run){const c=await db.getConnection();try{await c.beginTransaction();const value=await run(c);await c.commit();return value;}catch(error){await c.rollback();throw error;}finally{c.release();}}
async function ensureSchema(db=pool){
 if(!schemas.has(db))schemas.set(db,(async()=>{
  await db.query(TABLE);
  const initial=String(process.env.ATTENDANCE_DISPLAY_BOOTSTRAP_SHA256||'');if(!initial)return;
  if(!/^[a-f0-9]{64}$/.test(initial))throw fail('The display provisioning configuration is invalid.','ATTENDANCE_DISPLAY_CONFIGURATION_INVALID',503);
  await transaction(db,async c=>{const id=crypto.randomUUID(),site=qr.siteId(),label='Workplace display';
   const [insert]=await c.query('INSERT IGNORE INTO attendance_display_links(id,site_id,label,credential_hash,created_by) VALUES(?,?,?,?,NULL)',[id,site,label,initial]);
   if(insert.affectedRows)await audit(c,null,'ATTENDANCE_DISPLAY_PROVISIONED',{id,site_id:site,label,revision:1,created_by:null},null,null,{source:'AUTHORISED_RELEASE_CONFIGURATION'});
  });
 })().catch(error=>{schemas.delete(db);throw error;}));
 return schemas.get(db);
}
async function list({db=pool}={}){await ensureSchema(db);const [rows]=await db.query('SELECT * FROM attendance_display_links WHERE site_id=? ORDER BY created_at DESC,id DESC',[qr.siteId()]);return{site_id:qr.siteId(),site_name:String(process.env.SHIFT_QR_SITE_LABEL||'Voxel Veda Attendance'),links:rows.map(publicRecord)};}
function replay(row,fingerprint){if(row.request_sha256!==fingerprint)throw fail('This request identifier was used for a different display change.','ATTENDANCE_DISPLAY_REQUEST_CONFLICT',409);return{display:publicRecord(row),already_created:true,link_unavailable:true,message:'This display was already created. If its one-time link was not saved, replace it to issue a new link.'};}
async function create({user,input,replaceId=null,req,db=pool}){
 const rid=requestId(input.request_id),label=text(input.label,'display name'),reason=replaceId?text(input.reason,'replacement reason',1000,3):null;
 const fingerprint=digest(JSON.stringify({label,replaceId,reason,revision:input.expected_revision??null,site:qr.siteId()}));
 await ensureSchema(db);
 return transaction(db,async c=>{
  const [[existing]]=await c.query('SELECT * FROM attendance_display_links WHERE request_id=? FOR UPDATE',[rid]);if(existing)return replay(existing,fingerprint);
  let old;if(replaceId){[[old]]=await c.query('SELECT * FROM attendance_display_links WHERE id=? AND site_id=? FOR UPDATE',[replaceId,qr.siteId()]);if(!old)throw fail('Display not found.','ATTENDANCE_DISPLAY_NOT_FOUND',404);revision(input.expected_revision,old);if(old.revoked_at)throw fail('This display is already revoked. Create a new display link.','ATTENDANCE_DISPLAY_REVOKED',409);}
  const credential='vvd1_'+crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  try{await c.query('INSERT INTO attendance_display_links(id,site_id,label,credential_hash,request_id,request_sha256,created_by) VALUES(?,?,?,?,?,?,?)',[id,qr.siteId(),label,digest(credential),rid,fingerprint,user.id]);}catch(error){if(error.code==='ER_DUP_ENTRY')throw fail('This request is already being processed. Refresh the display list before retrying.','ATTENDANCE_DISPLAY_REQUEST_IN_PROGRESS',409);throw error;}
  const [[row]]=await c.query('SELECT * FROM attendance_display_links WHERE id=?',[id]);
  if(old){await c.query('UPDATE attendance_display_links SET revoked_at=UTC_TIMESTAMP(),revoked_by=?,revoke_reason=?,replaced_by=?,revision=revision+1 WHERE id=?',[user.id,reason,id,old.id]);const [[updated]]=await c.query('SELECT * FROM attendance_display_links WHERE id=?',[old.id]);await audit(c,user,'ATTENDANCE_DISPLAY_REPLACED',updated,publicRecord(old),req);}
  await audit(c,user,'ATTENDANCE_DISPLAY_CREATED',row,null,req);
  return{display:publicRecord(row),url:urls.app+'/attendance-display/#display='+credential,one_time_link:true};
 });
}
async function revoke({user,id,input,req,db=pool}){
 const rid=requestId(input.request_id),reason=text(input.reason,'revocation reason',1000,3),fingerprint=digest(JSON.stringify({id,reason,revision:input.expected_revision}));await ensureSchema(db);
 return transaction(db,async c=>{const [[row]]=await c.query('SELECT * FROM attendance_display_links WHERE id=? AND site_id=? FOR UPDATE',[id,qr.siteId()]);if(!row)throw fail('Display not found.','ATTENDANCE_DISPLAY_NOT_FOUND',404);
  if(row.revoked_request_id===rid){if(row.revoked_request_sha256!==fingerprint)throw fail('This request identifier was used for a different change.','ATTENDANCE_DISPLAY_REQUEST_CONFLICT',409);return{display:publicRecord(row),existing:true};}
  revision(input.expected_revision,row);if(row.revoked_at)throw fail('This display is already revoked.','ATTENDANCE_DISPLAY_REVOKED',409);
  await c.query('UPDATE attendance_display_links SET revoked_at=UTC_TIMESTAMP(),revoked_by=?,revoke_reason=?,revoked_request_id=?,revoked_request_sha256=?,revision=revision+1 WHERE id=?',[user.id,reason,rid,fingerprint,id]);
  const [[updated]]=await c.query('SELECT * FROM attendance_display_links WHERE id=?',[id]);await audit(c,user,'ATTENDANCE_DISPLAY_REVOKED',updated,publicRecord(row),req);return{display:publicRecord(updated)};
 });
}
async function current({credential,db=pool,now=new Date()}){
 if(typeof credential!=='string'||!/^vvd1_[A-Za-z0-9_-]{43}$/.test(credential))throw fail('Open a valid attendance display link.','ATTENDANCE_DISPLAY_UNAVAILABLE',403);
 await ensureSchema(db);const [[row]]=await db.query('SELECT * FROM attendance_display_links WHERE credential_hash=?',[digest(credential)]);
 if(!row||row.revoked_at||row.site_id!==qr.siteId())throw fail('This display link is invalid, revoked or no longer assigned to this workplace. Ask an authorised administrator for a replacement.','ATTENDANCE_DISPLAY_UNAVAILABLE',403);
 const {token,...code}=qr.createSiteToken(now),image=await renderAttendanceQr(code.qr_data,16);
 return{...code,image_png_base64:image.buffer.toString('base64'),modules:image.modules};
}
module.exports={ensureSchema,list,create,revoke,current,TABLE};
