'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const pool = require('../config/db');
const storage = require('./objectStorageService');
const scanner = require('./malwareScannerService');
const { logAudit } = require('./auditService');
const { ensureSecurityGovernanceSchema } = require('./securityGovernanceSchema');
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 24000000;
const MAX_DIMENSION = 12000;
const SIZE = 512;
const COLUMNS = { profile_photo_object_key:'VARCHAR(500) NULL', profile_photo_sha256:'CHAR(64) NULL', profile_photo_width:'INT UNSIGNED NULL', profile_photo_height:'INT UNSIGNED NULL' };
let schemaPromise;
let normalising = 0;
function photoError(message, code='PROFILE_PHOTO_INVALID', statusCode=400) {
  return Object.assign(new Error(message), {code,statusCode,fields:{photo:message}});
}
async function ensureProfilePhotoSchema() {
  if (!schemaPromise) schemaPromise = (async()=>{
    const [columns]=await pool.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',['user_profiles']);
    const existing=new Set(columns.map(row=>row.COLUMN_NAME));
    for(const [column,definition] of Object.entries(COLUMNS)) if(!existing.has(column)) {
      try {await pool.query(`ALTER TABLE user_profiles ADD COLUMN ${column} ${definition}`);}
      catch(error){if(error.code!=='ER_DUP_FIELDNAME')throw error;}
    }
  })().catch(error=>{schemaPromise=null;throw error;});
  return schemaPromise;
}
function boundedDimensions(width,height) {
  if (!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS) {
    throw photoError('Photo dimensions are too large. Choose an image up to 24 megapixels.','PROFILE_PHOTO_DIMENSIONS_INVALID');
  }
  return {width,height};
}
function exifOrientation(segment) {
  if(segment.length<22||segment.subarray(0,6).toString('ascii')!=='Exif\0\0')return 1;
  const tiff=segment.subarray(6), little=tiff.subarray(0,2).toString('ascii')==='II';
  if(!little && tiff.subarray(0,2).toString('ascii')!=='MM')return 1;
  const read16=offset=>little?tiff.readUInt16LE(offset):tiff.readUInt16BE(offset);
  const read32=offset=>little?tiff.readUInt32LE(offset):tiff.readUInt32BE(offset);
  if(read16(2)!==42)return 1;
  const offset=read32(4);if(offset+2>tiff.length)return 1;
  const count=read16(offset);if(count>1024||offset+2+count*12>tiff.length)return 1;
  for(let i=0;i<count;i++){
    const p=offset+2+i*12;
    if(read16(p)===0x0112 && read16(p+2)===3 && read32(p+4)===1){const value=read16(p+8);return value>=1&&value<=8?value:1;}
  }
  return 1;
}
function inspectPhoto(bytes,mime) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)throw photoError('Profile photo must contain image bytes and be 5 MB or smaller.','PROFILE_PHOTO_SIZE_INVALID',413);
  if(mime==='image/png' && bytes.length>=33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString('ascii')==='IHDR') {
    for(let at=8;at+12<=bytes.length;){const size=bytes.readUInt32BE(at),type=bytes.subarray(at+4,at+8).toString('ascii');if(size>bytes.length-at-12)throw photoError('This PNG image is damaged.');if(type==='acTL')throw photoError('Choose a still photo rather than an animated image.');if(type==='IDAT'||type==='IEND')break;at+=size+12;}
    return {...boundedDimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20)),orientation:1,decodeBytes:bytes};
  }
  if(mime==='image/jpeg' && bytes.length>=4 && bytes.readUInt16BE(0)===0xffd8){
    let at=2,dimensions,orientation=1;const retained=[bytes.subarray(0,2)];
    while(at+4<=bytes.length){
      const start=at;if(bytes[at++]!==0xff)throw photoError('This JPG image is damaged. Choose another photo.');
      while(bytes[at]===0xff)at++;
      if(at+3>bytes.length)throw photoError('This JPG image is damaged. Choose another photo.');
      const marker=bytes[at++];
      if(marker===0xda){retained.push(bytes.subarray(start));break;}
      if(marker===0xd9)break;
      const length=bytes.readUInt16BE(at);if(length<2||at+length>bytes.length)throw photoError('This JPG image is damaged. Choose another photo.');
      const segment=bytes.subarray(at+2,at+length);
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&segment.length>=6)dimensions=boundedDimensions(segment.readUInt16BE(3),segment.readUInt16BE(1));
      // Remove APP1 before decoding so Skia cannot apply EXIF orientation twice.
      if(marker===0xe1){if(segment.subarray(0,6).toString('ascii')==='Exif\0\0')orientation=exifOrientation(segment);}else retained.push(bytes.subarray(start,at+length));
      at+=length;
    }
    if(!dimensions)throw photoError('This JPG image has no valid dimensions.');
    return {...dimensions,orientation,decodeBytes:Buffer.concat(retained)};
  }
  if(mime==='image/webp' && bytes.length>=30 && bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP'){
    const type=bytes.subarray(12,16).toString();let width,height;
    if(type==='VP8X'){if(bytes[20]&2)throw photoError('Choose a still photo rather than an animated image.');width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;}
    else if(type==='VP8 ' && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
    else if(type==='VP8L' && bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
    if(!width||!height)throw photoError('This WebP image has no valid dimensions.');
    return {...boundedDimensions(width,height),orientation:1,decodeBytes:bytes};
  }
  throw photoError('Profile photo must be a genuine JPG, PNG or WebP image.','PROFILE_PHOTO_SIGNATURE_INVALID');
}
async function scanPhoto(bytes) {
  const config=scanner.scannerConfig();
  if(!scanner.configured(config)){
    if(process.env.NODE_ENV==='production' && String(process.env.MALWARE_SCANNER_REQUIRED).toLowerCase()==='true')throw photoError('Secure photo scanning is unavailable. Your current photo is unchanged.','MALWARE_SCANNER_REQUIRED',503);
    return;
  }
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vv-profile-scan-'));
  try{
    const filename=path.join(directory,'source');await fs.writeFile(filename,bytes,{mode:0o600});
    try{await scanner.scanFile(filename,config);}catch(error){if(error.code==='MALWARE_DETECTED'||config.failClosed)throw photoError(error.code==='MALWARE_DETECTED'?'This photo was rejected by the security scanner.':'Secure photo scanning is unavailable. Your current photo is unchanged.',error.code||'MALWARE_SCANNER_UNAVAILABLE',error.code==='MALWARE_DETECTED'?422:503);}
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
async function normaliseProfilePhoto(file,crop={}) {
  const info=inspectPhoto(file?.buffer,String(file?.mimetype||'').toLowerCase());
  const x=crop.x===undefined?0.5:Number(crop.x),y=crop.y===undefined?0.5:Number(crop.y),zoom=crop.zoom===undefined?1:Number(crop.zoom);
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(zoom)||x<0||x>1||y<0||y>1||zoom<1||zoom>3)throw photoError('Choose a valid crop position and zoom.','PROFILE_PHOTO_CROP_INVALID');
  if(normalising>=2)throw photoError('Photo processing is busy. Retry shortly; your current photo is unchanged.','PROFILE_PHOTO_BUSY',503);
  normalising++;
  try{
    await scanPhoto(file.buffer);
    let image;try{image=await loadImage(info.decodeBytes);}catch{throw photoError('This image cannot be decoded. Choose a different JPG, PNG or WebP photo.','PROFILE_PHOTO_DECODE_FAILED');}
    if(image.width!==info.width||image.height!==info.height)throw photoError('Decoded photo dimensions do not match the image.','PROFILE_PHOTO_DIMENSIONS_INVALID');
    const swapped=info.orientation>=5, width=swapped?info.height:info.width,height=swapped?info.width:info.height;
    const side=Math.min(width,height)/zoom,left=(width-side)*x,top=(height-side)*y,scale=SIZE/side;
    const canvas=createCanvas(SIZE,SIZE),context=canvas.getContext('2d');
    context.fillStyle='#ffffff';context.fillRect(0,0,SIZE,SIZE);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.scale(scale,scale);context.translate(-left,-top);
    const transforms={1:[1,0,0,1,0,0],2:[-1,0,0,1,info.width,0],3:[-1,0,0,-1,info.width,info.height],4:[1,0,0,-1,0,info.height],5:[0,1,1,0,0,0],6:[0,1,-1,0,info.height,0],7:[0,-1,-1,0,info.height,info.width],8:[0,-1,1,0,0,info.width]};
    context.transform(...transforms[info.orientation]);context.drawImage(image,0,0);
    const buffer=await canvas.encode('jpeg',86);
    return {buffer,mime:'image/jpeg',size:buffer.length,width:SIZE,height:SIZE,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};
  }finally{normalising--;}
}
function photoMetadata(row){return {mime:row?.profile_photo_mime||null,size:Number(row?.profile_photo_size||0),sha256:row?.profile_photo_sha256||null,object_key:row?.profile_photo_object_key||null};}
async function saveProfilePhoto(userId,file,req,crop={}) {
  const photo=await normaliseProfilePhoto(file,crop);
  await ensureProfilePhotoSchema();await ensureSecurityGovernanceSchema();
  let connection,objectKey,committed=false;
  try{
    if(storage.isConfigured()){objectKey=`profile-photos/${userId}/${crypto.randomUUID()}.jpg`;await storage.putObject(objectKey,photo.buffer,photo.mime);}
    else if(String(process.env.OBJECT_STORAGE_PROVIDER||'').trim())throw photoError('Private photo storage is unavailable. Your current photo is unchanged.','PROFILE_PHOTO_STORAGE_UNAVAILABLE',503);
    connection=await pool.getConnection();await connection.beginTransaction();
    const [[account]]=await connection.query('SELECT id FROM users WHERE id=? AND active=1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE',[userId]);
    if(!account)throw photoError('Your account is unavailable. Sign in again.','AUTH_REQUIRED',401);
    const [[previous]]=await connection.query('SELECT profile_photo_mime,profile_photo_size,profile_photo_sha256,profile_photo_object_key,profile_photo_updated_at FROM user_profiles WHERE user_id=? FOR UPDATE',[userId]);
    if(previous?.profile_photo_sha256===photo.sha256){await connection.commit();committed=true;connection.release();connection=null;if(objectKey)await storage.deleteObject(objectKey).catch(()=>{});return {...photo,unchanged:true,updatedAt:previous.profile_photo_updated_at};}
    await connection.query(`INSERT INTO user_profiles(user_id,profile_photo,profile_photo_mime,profile_photo_size,profile_photo_updated_at,profile_photo_object_key,profile_photo_sha256,profile_photo_width,profile_photo_height)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP(3),?,?,?,?) ON DUPLICATE KEY UPDATE profile_photo=VALUES(profile_photo),profile_photo_mime=VALUES(profile_photo_mime),profile_photo_size=VALUES(profile_photo_size),profile_photo_updated_at=CURRENT_TIMESTAMP(3),profile_photo_object_key=VALUES(profile_photo_object_key),profile_photo_sha256=VALUES(profile_photo_sha256),profile_photo_width=VALUES(profile_photo_width),profile_photo_height=VALUES(profile_photo_height),updated_at=CURRENT_TIMESTAMP(3)`,
      [userId,objectKey?null:photo.buffer,photo.mime,photo.size,objectKey||null,photo.sha256,photo.width,photo.height]);
    const [[saved]]=await connection.query('SELECT profile_photo_updated_at FROM user_profiles WHERE user_id=?',[userId]);photo.updatedAt=saved?.profile_photo_updated_at||null;
    await logAudit(connection,{actorId:userId,action:'PROFILE_PHOTO_UPDATED',module:'profile',recordType:'profile_photo',recordId:userId,oldValue:photoMetadata(previous),newValue:{mime:photo.mime,size:photo.size,sha256:photo.sha256,object_key:objectKey||null},ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.requestId,sessionId:req.session?.id});
    await connection.commit();committed=true;return photo;
  }catch(error){
    if(connection){await connection.rollback().catch(()=>{});connection.release();connection=null;}
    // A lost commit reply must never delete an object that the saved profile references.
    if(objectKey&&!committed)try{const [[current]]=await pool.query('SELECT profile_photo_object_key FROM user_profiles WHERE user_id=?',[userId]);if(current?.profile_photo_object_key!==objectKey)await storage.deleteObject(objectKey);}catch{/* Preserve bytes until storage/DB outcome can be reconciled. */}
    throw error;
  }finally{connection?.release();}
}
async function getProfilePhoto(userId) {
  await ensureProfilePhotoSchema();
  const [[row]]=await pool.query('SELECT profile_photo,profile_photo_mime,profile_photo_size,profile_photo_updated_at,profile_photo_object_key,profile_photo_sha256 FROM user_profiles WHERE user_id=? LIMIT 1',[userId]);
  if(!row?.profile_photo_mime||(!row.profile_photo&&!row.profile_photo_object_key))return null;
  const buffer=row.profile_photo_object_key?await storage.getObject(row.profile_photo_object_key):row.profile_photo;
  if(row.profile_photo_sha256&&crypto.createHash('sha256').update(buffer).digest('hex')!==row.profile_photo_sha256)throw photoError('The stored photo could not be verified. Retry or upload a new photo.','PROFILE_PHOTO_INTEGRITY_FAILED',503);
  const mime=String(row.profile_photo_mime).toLowerCase(),info=inspectPhoto(buffer,mime);
  if(!row.profile_photo_sha256){
    if(normalising>=2)throw photoError('Photo processing is busy. Retry shortly.','PROFILE_PHOTO_BUSY',503);
    normalising++;
    try{const image=await loadImage(info.decodeBytes);if(image.width!==info.width||image.height!==info.height)throw new Error('dimensions');}catch{throw photoError('Your stored photo cannot be decoded. Upload a new photo.','PROFILE_PHOTO_DECODE_FAILED',422);}finally{normalising--;}
  }
  return {buffer,mime,updatedAt:row.profile_photo_updated_at,sha256:row.profile_photo_sha256};
}
async function removeProfilePhoto(userId,req) {
  await ensureProfilePhotoSchema();await ensureSecurityGovernanceSchema();
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    const [[previous]]=await connection.query('SELECT profile_photo_mime,profile_photo_size,profile_photo_sha256,profile_photo_object_key FROM user_profiles WHERE user_id=? FOR UPDATE',[userId]);
    if(!previous?.profile_photo_mime){await connection.commit();return {unchanged:true};}
    await connection.query(`UPDATE user_profiles SET profile_photo=NULL,profile_photo_mime=NULL,profile_photo_size=NULL,profile_photo_object_key=NULL,profile_photo_sha256=NULL,profile_photo_width=NULL,profile_photo_height=NULL,profile_photo_updated_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE user_id=?`,[userId]);
    await logAudit(connection,{actorId:userId,action:'PROFILE_PHOTO_REMOVED',module:'profile',recordType:'profile_photo',recordId:userId,oldValue:photoMetadata(previous),newValue:null,ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.requestId,sessionId:req.session?.id});
    await connection.commit();return {unchanged:false};
    // Previous private objects are retained for audit/recovery; never erase historical references here.
  }catch(error){await connection.rollback().catch(()=>{});throw error;}finally{connection.release();}
}
module.exports={ensureProfilePhotoSchema,normaliseProfilePhoto,saveProfilePhoto,getProfilePhoto,removeProfilePhoto,MAX_BYTES,_test:{inspectPhoto,exifOrientation,boundedDimensions}};
