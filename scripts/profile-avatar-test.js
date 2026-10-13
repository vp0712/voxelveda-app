'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const state={profiles:new Map(),objects:new Map(),audits:[],s3:false,auditFailure:false,lostCommit:false,deletedObjects:[],columns:[],scannerConfigured:true,scannerFailure:false,scannedFiles:[]};
const users=new Map([[1,{id:1,role:'staff',department:'Operations',manager_id:3,access_scope:{}}],[2,{id:2,role:'staff',department:'Sales',manager_id:4,access_scope:{}}],[3,{id:3,role:'manager',department:'Operations',access_scope:{}}],[4,{id:4,role:'manager',department:'Sales',access_scope:{}}],[8,{id:8,role:'hr',access_scope:{departments:['Operations']}}],[9,{id:9,role:'customer',department:'Operations',access_scope:{}}]]);
const cloneProfiles=()=>new Map([...state.profiles].map(([id,row])=>[id,{...row,profile_photo:row.profile_photo?Buffer.from(row.profile_photo):null}]));
const db={async query(sql,params=[]){const text=sql.replace(/\s+/g,' ').trim();
 if(text.startsWith('SELECT COLUMN_NAME'))return [[...['user_id','profile_photo','profile_photo_mime','profile_photo_size','profile_photo_updated_at'].map(COLUMN_NAME=>({COLUMN_NAME}))]];
 if(text.startsWith('ALTER TABLE user_profiles')){state.columns.push(text);return [{}];}
 if(text.startsWith('SELECT id FROM users WHERE id=?'))return [[users.has(Number(params[0]))?{id:Number(params[0])}:undefined].filter(Boolean)];
 if(text.startsWith('SELECT id FROM users WHERE id = ? AND manager_id = ?')){const row=users.get(Number(params[0]));return [[row?.manager_id===Number(params[1])?{id:row.id}:undefined].filter(Boolean)];}
 if(text.startsWith('SELECT id,role,department,manager_id FROM users'))return [[users.get(Number(params[0]))].filter(Boolean)];
 if(text.startsWith('SELECT access_scope FROM users'))return [[users.get(Number(params[0]))].filter(Boolean)];
 if(text.startsWith('SELECT profile_photo'))return [[state.profiles.get(Number(params[0]))].filter(Boolean)];
 if(text.startsWith('INSERT INTO user_profiles')){const [id,buffer,mime,size,key,hash,width,height]=params;state.profiles.set(id,{profile_photo:buffer?Buffer.from(buffer):null,profile_photo_mime:mime,profile_photo_size:size,profile_photo_object_key:key,profile_photo_sha256:hash,profile_photo_width:width,profile_photo_height:height});return [{affectedRows:1}];}
 if(text.startsWith('UPDATE user_profiles SET profile_photo=NULL')){state.profiles.set(params[0],{});return [{affectedRows:1}];}
 throw new Error('Unexpected avatar fixture SQL: '+text);
},async getConnection(){let snapshot,active=false;return {query:db.query,async beginTransaction(){active=true;snapshot=cloneProfiles();},async commit(){active=false;if(state.lostCommit){state.lostCommit=false;throw new Error('Lost commit reply');}},async rollback(){if(active)state.profiles=snapshot;active=false;},release(){}};}};
function mock(name,value){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports:value};}
mock('../config/db',db);
mock('../services/objectStorageService',{isConfigured:()=>state.s3,async putObject(key,bytes){state.objects.set(key,Buffer.from(bytes));},async getObject(key){return state.objects.get(key);},async deleteObject(key){state.deletedObjects.push(key);state.objects.delete(key);}});
mock('../services/malwareScannerService',{scannerConfig:()=>({failClosed:true}),configured:()=>state.scannerConfigured,async scanFile(filename){
 const bytes=await fs.promises.readFile(filename),stat=await fs.promises.stat(filename);assert(bytes.length>0);assert.equal(stat.mode&0o777,0o600,'Photo scanning uses a private temporary source file');state.scannedFiles.push(filename);
 if(state.scannerFailure)throw Object.assign(new Error('Unavailable fixture scanner'),{code:'MALWARE_SCANNER_UNAVAILABLE'});
 return {clean:true,infected:false,signature:null};
}});
mock('../services/securityGovernanceSchema',{async ensureSecurityGovernanceSchema(){}});
mock('../services/hrAdministrationSchema',{async ensureHrAdministrationSchema(){}});
mock('../services/sessionService',{async logSecurityEvent(){}});
mock('../services/auditService',{async logAudit(connection,entry){assert.notEqual(connection,db);if(state.auditFailure)throw new Error('Audit unavailable');state.audits.push(entry);}});
const service=require('../services/profilePhotoService');
const controller=require('../controllers/profileController');
function jpegExif(bytes,orientation){const segment=Buffer.alloc(32);segment.write('Exif\0\0');segment.write('II',6);segment.writeUInt16LE(42,8);segment.writeUInt32LE(8,10);segment.writeUInt16LE(1,14);segment.writeUInt16LE(0x0112,16);segment.writeUInt16LE(3,18);segment.writeUInt32LE(1,20);segment.writeUInt16LE(orientation,24);const prefix=Buffer.alloc(4);prefix.writeUInt16BE(0xffe1,0);prefix.writeUInt16BE(segment.length+2,2);return Buffer.concat([bytes.subarray(0,2),prefix,segment,bytes.subarray(2)]);}
function response(){return {code:200,headers:{},status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(key,value){this.headers[key]=value;},send(bytes){this.bytes=bytes;return this;},end(){return this;}};}
function request(id=1){return {user:{id,role:users.get(id)?.role||'staff'},params:{},body:{},ip:'127.0.0.1',get:()=> 'isolated-avatar-fixture'};}
async function main(){
 const canvas=createCanvas(400,200),ctx=canvas.getContext('2d');
 for(const [color,x,y] of [['#ff0000',0,0],['#0000ff',0,100],['#ffff00',200,0],['#00ff00',200,100]]){ctx.fillStyle=color;ctx.fillRect(x,y,200,100);}
 const jpeg=await canvas.encode('jpeg',95),png=await canvas.encode('png'),webp=await canvas.encode('webp',95);
 const file={buffer:jpeg,mimetype:'image/jpeg',size:jpeg.length};
 const rotated=await service.normaliseProfilePhoto({...file,buffer:jpegExif(jpeg,6)});
 assert.equal(rotated.width,512);assert.equal(rotated.height,512);assert.equal(rotated.mime,'image/jpeg');assert.ok(rotated.size<1000000);
 const image=await loadImage(rotated.buffer),inspect=createCanvas(512,512),pixels=inspect.getContext('2d');pixels.drawImage(image,0,0);
 const pixel=(x,y)=>[...pixels.getImageData(x,y,1,1).data].slice(0,3);
 const [tl,tr,bl,br]=[pixel(128,128),pixel(384,128),pixel(128,384),pixel(384,384)];
 assert(tl[2]>200&&tl[0]<40,'EXIF 6 upper-left must be blue');assert(tr[0]>200&&tr[1]<40,'EXIF 6 upper-right must be red');assert(bl[1]>200&&bl[0]<40,'EXIF 6 lower-left must be green');assert(br[0]>200&&br[1]>200,'EXIF 6 lower-right must be yellow');
 const exif=jpegExif(jpeg,6),xmp=Buffer.from('http://ns.adobe.com/xap/1.0/\0<fixture/>'),xmpHeader=Buffer.alloc(4);xmpHeader.writeUInt16BE(0xffe1,0);xmpHeader.writeUInt16BE(xmp.length+2,2);
 const withXmp=Buffer.concat([exif.subarray(0,38),xmpHeader,xmp,exif.subarray(38)]);assert.equal((await service.normaliseProfilePhoto({...file,buffer:withXmp})).sha256,rotated.sha256,'Later XMP metadata cannot reset phone EXIF orientation');
 for(const [bytes,mimetype] of [[png,'image/png'],[webp,'image/webp']])assert.equal((await service.normaliseProfilePhoto({buffer:bytes,mimetype})).mime,'image/jpeg');
 const left=await service.normaliseProfilePhoto(file,{x:0,y:0.5,zoom:1}),right=await service.normaliseProfilePhoto(file,{x:1,y:0.5,zoom:1});assert.notEqual(left.sha256,right.sha256,'User crop position must change the retained pixels');
 for(const [buffer,mimetype] of [[Buffer.from('<svg></svg>'),'image/png'],[jpeg,'image/png'],[Buffer.from([255,216,255,1,0,0]),'image/jpeg']])await assert.rejects(()=>service.normaliseProfilePhoto({buffer,mimetype}));
 const huge=Buffer.from(png);huge.writeUInt32BE(100000,16);assert.throws(()=>service._test.inspectPhoto(huge,'image/png'),{code:'PROFILE_PHOTO_DIMENSIONS_INVALID'});
 await assert.rejects(()=>service.normaliseProfilePhoto(file,{zoom:4}),{code:'PROFILE_PHOTO_CROP_INVALID'});
 const oldNodeEnv=process.env.NODE_ENV,oldRequired=process.env.MALWARE_SCANNER_REQUIRED,oldConfigured=state.scannerConfigured;process.env.NODE_ENV='production';process.env.MALWARE_SCANNER_REQUIRED='true';state.scannerConfigured=false;
 try{const before=state.scannedFiles.length;await assert.rejects(()=>service.normaliseProfilePhoto(file),{code:'MALWARE_SCANNER_REQUIRED'});assert.equal(state.scannedFiles.length,before,'A required but unconfigured scanner blocks before accepting the photo');}finally{state.scannerConfigured=oldConfigured;oldNodeEnv===undefined?delete process.env.NODE_ENV:process.env.NODE_ENV=oldNodeEnv;oldRequired===undefined?delete process.env.MALWARE_SCANNER_REQUIRED:process.env.MALWARE_SCANNER_REQUIRED=oldRequired;}
 state.scannerConfigured=true;state.scannerFailure=true;try{const before=state.scannedFiles.length;await assert.rejects(()=>service.normaliseProfilePhoto(file),{code:'MALWARE_SCANNER_UNAVAILABLE'});assert.equal(state.scannedFiles.length,before+1,'An unavailable configured scanner fails closed after attempting the source scan');}finally{state.scannerFailure=false;state.scannerConfigured=oldConfigured;}
 const first=service.normaliseProfilePhoto(file),second=service.normaliseProfilePhoto(file);await assert.rejects(()=>service.normaliseProfilePhoto(file),{code:'PROFILE_PHOTO_BUSY'});await Promise.all([first,second]);
 const req=request();const saved=await service.saveProfilePhoto(1,file,req);const original=await service.getProfilePhoto(1);assert.deepEqual(original.buffer,saved.buffer);assert.equal(state.audits.length,1);
 const duplicate=await service.saveProfilePhoto(1,file,req);assert.equal(duplicate.unchanged,true);assert.equal(state.audits.length,1);
 state.auditFailure=true;await assert.rejects(()=>service.saveProfilePhoto(1,{buffer:png,mimetype:'image/png'},req,{x:0}));assert.deepEqual((await service.getProfilePhoto(1)).buffer,saved.buffer);state.auditFailure=false;
 state.s3=true;const changed=await service.saveProfilePhoto(1,file,req,{x:0});assert.equal(state.profiles.get(1).profile_photo,null);assert.ok(state.profiles.get(1).profile_photo_object_key);assert.deepEqual((await service.getProfilePhoto(1)).buffer,changed.buffer);
 const historicalKey=state.profiles.get(1).profile_photo_object_key;state.auditFailure=true;await assert.rejects(()=>service.saveProfilePhoto(1,file,req,{x:1}));assert.ok(state.objects.has(historicalKey));assert.equal(state.objects.size,1,'Fresh rejected object is cleaned while historical object remains');state.auditFailure=false;
 state.lostCommit=true;await assert.rejects(()=>service.saveProfilePhoto(1,file,req,{x:1}));const committedKey=state.profiles.get(1).profile_photo_object_key;assert.ok(state.objects.has(committedKey),'Lost commit reply cannot erase referenced photo bytes');
 const res=response();await controller.getMyProfilePhoto(req,res);assert.equal(res.code,200);assert.equal(res.headers['Content-Type'],'image/jpeg');assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers.Vary,'Cookie, Authorization');
 assert.equal(await controller._test.mayViewStaffPhoto({id:3,role:'manager'},1,db),true);assert.equal(await controller._test.mayViewStaffPhoto({id:3,role:'manager'},2,db),false);assert.equal(await controller._test.mayViewStaffPhoto({id:8,role:'hr'},1,db),true);assert.equal(await controller._test.mayViewStaffPhoto({id:8,role:'hr'},2,db),false,'Saved department boundary must constrain HR');
 assert.equal(await controller._test.mayViewStaffPhoto({id:9,role:'customer',permissions:['VIEW_STAFF_HR']},1,db),false);assert.equal(await controller._test.mayViewStaffPhoto({id:1,role:'staff',permissions:['VIEW_CONFIDENTIAL_FILES']},2,db),false);assert.equal(await controller._test.mayViewStaffPhoto({id:1,role:'staff'},1,db),true);
 state.auditFailure=true;await assert.rejects(()=>service.removeProfilePhoto(1,req));assert.ok(await service.getProfilePhoto(1));state.auditFailure=false;await service.removeProfilePhoto(1,req);assert.equal(await service.getProfilePhoto(1),null);assert.ok(state.objects.has(committedKey),'Removal revokes access while preserving historical private bytes');
 assert.equal(state.columns.length,4);assert(state.columns.every(sql=>! /DROP|DELETE|UPDATE|TRUNCATE/.test(sql)));
 assert(state.scannedFiles.length>10,'Valid image workflows exercise the configured scanner instead of skipping security checks');assert(state.scannedFiles.every(filename=>!fs.existsSync(filename)),'Successful and failed scans clean private temporary source files');
 console.log('Profile avatar tests passed: genuine JPG/PNG/WebP decode; EXIF pixel orientation; chosen square crop; predecode dimension/magic bounds; configured clean scans and required/unavailable fail-closed checks; private scan-file cleanup; durable DB and private object references; safe duplicate save; atomic audit rollback; lost-commit preservation; own/team/department/customer boundaries; authorised image metadata; archive without historical byte deletion.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
