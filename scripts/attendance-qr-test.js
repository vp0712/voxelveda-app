'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const previous={key:process.env.SHIFT_QR_SIGNING_KEY,site:process.env.SHIFT_QR_SITE_ID};
process.env.SHIFT_QR_SIGNING_KEY=crypto.randomBytes(32).toString('hex');
process.env.SHIFT_QR_SITE_ID='fixture-workplace-a';
const qr=require('../services/attendanceQrService');
const at=new Date('2026-10-13T00:00:00Z');
function claims(token){return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}
function signed(value){const payload=Buffer.from(JSON.stringify(value)).toString('base64url'),body='VVATT1.'+payload;return body+'.'+crypto.createHmac('sha256',process.env.SHIFT_QR_SIGNING_KEY).update(body).digest('base64url');}
try{
 const site=qr.createSiteToken(at),decoded=qr.validateSiteToken(site.token,at);
 assert.equal(decoded.site_id,'fixture-workplace-a');assert.equal(decoded.purpose,'ATTENDANCE_SITE');
 assert.throws(()=>qr.validateSiteToken('https://unrelated.invalid/?shift_qr_token='+site.token,at),{code:'ATTENDANCE_QR_INVALID'});
 const changed=site.token.split('.');changed[2]=(changed[2].startsWith('A')?'B':'A')+changed[2].slice(1);
 assert.throws(()=>qr.validateSiteToken(changed.join('.'),at),{code:'ATTENDANCE_QR_INVALID'});
 assert.throws(()=>qr.validateSiteToken(site.token,new Date(site.expires_at)),{code:'ATTENDANCE_QR_EXPIRED'});
 assert.throws(()=>qr.validateSiteToken(signed({...decoded,site_id:'fixture-workplace-b'}),at),{code:'ATTENDANCE_QR_WRONG_SITE'});
 assert.throws(()=>qr.validateSiteToken(signed({...decoded,purpose:'UNRELATED_LINK'}),at),{code:'ATTENDANCE_QR_WRONG_PURPOSE'});
 assert.throws(()=>qr.validateSiteToken(signed({...decoded,exp:decoded.iat+3600}),at),{code:'ATTENDANCE_QR_EXPIRED'});
 const proof=qr.createActionProof({userId:11,action:'CHECK_OUT',attendanceId:31,priorAttendanceId:31,siteToken:site.token,now:at});
 const checked=qr.validateActionProof({token:proof.qr_proof,userId:11,action:'CHECK_OUT',attendanceId:31,now:at});
 assert.equal(checked.user_id,11);assert.equal(checked.attendance_id,31);assert.match(checked.jti,/^[0-9a-f-]{36}$/);
 assert.throws(()=>qr.validateActionProof({token:proof.qr_proof,userId:12,action:'CHECK_OUT',attendanceId:31,now:at}),{code:'ATTENDANCE_QR_WRONG_USER'});
 assert.throws(()=>qr.validateActionProof({token:proof.qr_proof,userId:11,action:'CHECK_IN',now:at}),{code:'ATTENDANCE_QR_WRONG_PURPOSE'});
 assert.throws(()=>qr.validateActionProof({token:proof.qr_proof,userId:11,action:'CHECK_OUT',attendanceId:32,now:at}),{code:'ATTENDANCE_QR_WRONG_SESSION'});
 assert.throws(()=>qr.validateSiteToken(proof.qr_proof,at),{code:'ATTENDANCE_QR_WRONG_PURPOSE'});
 assert.throws(()=>qr.validateActionProof({token:proof.qr_proof,userId:11,action:'CHECK_OUT',attendanceId:31,now:new Date(proof.expires_at)}),{code:'ATTENDANCE_QR_EXPIRED'});
 const next=qr.createActionProof({userId:11,action:'CHECK_IN',priorAttendanceId:31,siteToken:site.token,now:at});
 assert.equal(claims(next.qr_proof).prior_attendance_id,31,'Check-in proof binds the previously observed attendance state');
 console.log('ATTENDANCE_QR_TEST_OK: real signature, expiry, purpose, workplace, account and exact-session isolation; unrelated URL rejection');
}finally{
 for(const [name,value] of [['SHIFT_QR_SIGNING_KEY',previous.key],['SHIFT_QR_SITE_ID',previous.site]])if(value===undefined)delete process.env[name];else process.env[name]=value;
}
