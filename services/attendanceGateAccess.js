'use strict';
const crypto=require('node:crypto');
const qr=require('./attendanceQrService');
const cookieName='vv_attendance_gate';
function key(){const value=process.env.SHIFT_QR_SIGNING_KEY||(process.env.NODE_ENV==='production'?'':process.env.JWT_SECRET);if(!value)throw new Error('Attendance gate signing is unavailable');return value;}
function createAccess(now=Date.now()){
  const body=Buffer.from(JSON.stringify({purpose:'GATE_DISPLAY',site:qr.siteId(),exp:Math.floor(now/1000)+12*3600,nonce:crypto.randomBytes(16).toString('base64url')})).toString('base64url');
  return `${body}.${crypto.createHmac('sha256',key()).update('VV_GATE.'+body).digest('base64url')}`;
}
function validAccess(value,now=Date.now()){
  try{if(typeof value!=='string'||value.length>800)return false;const [body,signature,...extra]=value.split('.');if(extra.length||!signature)return false;const supplied=Buffer.from(signature,'base64url'),expected=crypto.createHmac('sha256',key()).update('VV_GATE.'+body).digest();if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return false;const claims=JSON.parse(Buffer.from(body,'base64url'));return claims.purpose==='GATE_DISPLAY'&&claims.site===qr.siteId()&&claims.exp>Math.floor(now/1000)&&claims.exp<=Math.floor(now/1000)+12*3600;}catch{return false;}
}
function hasAccess(req){const value=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);return validAccess(value);}
function exchange(req,res,next){
  res.set('Referrer-Policy','no-referrer');
  if(req.query.access===undefined)return next();
  if(!validAccess(req.query.access))return res.status(403).send('Attendance display access expired. Ask an authorised administrator to reconnect this kiosk.');
  res.cookie(cookieName,req.query.access,{httpOnly:true,secure:process.env.NODE_ENV==='production'||req.secure,sameSite:'strict',maxAge:12*3600*1000,path:'/'});
  return res.redirect(303,'/attendance-terminal');
}
module.exports={createAccess,validAccess,hasAccess,exchange};
