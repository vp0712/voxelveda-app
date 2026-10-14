'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const jsQR=require('jsqr');
process.env.SHIFT_QR_SIGNING_KEY=crypto.randomBytes(32).toString('hex');
process.env.SHIFT_QR_SITE_ID='verification-site-a';
const service=require('../services/attendanceQrService');
const gate=require('../services/attendanceGateAccess');
const {renderAttendanceQr}=require('../services/attendanceQrRenderer');
async function main(){
 const now=new Date('2026-10-14T00:00:00Z'),out=process.env.GATE_PROOF_DIR||'/tmp/voxel-gate-proof';fs.mkdirSync(out,{recursive:true});
 const results=[];let logoHash;
 for(let rotation=0;rotation<60;rotation++){
  const at=new Date(now.getTime()+rotation*20000),issued=service.createSiteToken(at);
  const rendered=await renderAttendanceQr(issued.qr_data),img=await loadImage(rendered.buffer);
  const logoCanvas=createCanvas(rendered.side,rendered.side),logoCtx=logoCanvas.getContext('2d');logoCtx.drawImage(img,0,0);const left=Math.floor((rendered.side-rendered.plate)/2),centre=logoCtx.getImageData(left,left,rendered.plate,rendered.plate);const centreHash=crypto.createHash('sha256').update(centre.data).digest('hex');if(!logoHash)logoHash=centreHash;assert.equal(centreHash,logoHash,'The original centre artwork persists unchanged in every rendered rotation');
  for(const scale of [4,5,6,8]){
   const side=(rendered.modules+8)*scale,canvas=createCanvas(side,side),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,side,side);
   const pixels=ctx.getImageData(0,0,side,side),decoded=jsQR(new Uint8ClampedArray(pixels.data),side,side,{inversionAttempts:'attemptBoth'});
   assert.equal(decoded?.data,issued.qr_data,`Actual branded rotation ${rotation} at ${side}px must decode`);
   const claims=service.validateSiteToken(decoded.data,at);assert.equal(claims.site_id,'verification-site-a');
   // Same gate is valid for two independently bound employee proofs.
   for(const userId of [101,102]){const proof=service.createActionProof({userId,action:'CHECK_IN',siteToken:decoded.data,now:at});assert.equal(service.validateActionProof({token:proof.qr_proof,userId,action:'CHECK_IN',now:at}).user_id,userId);}
   assert.throws(()=>service.validateSiteToken(decoded.data,new Date(issued.expires_at)),{code:'ATTENDANCE_QR_EXPIRED'});
   results.push({rotation,side,modules:rendered.modules,payload_bytes:Buffer.byteLength(decoded.data),decoded:true});
  }
  if(!rotation){fs.writeFileSync(path.join(out,'branded-qr.png'),rendered.buffer);const token=new URL(issued.qr_data).searchParams.get('t');assert.ok(token.length<90);assert.throws(()=>service.validateSiteToken(token.slice(0,-1)+'!',at),{code:'ATTENDANCE_QR_INVALID'});process.env.SHIFT_QR_SITE_ID='verification-site-b';assert.throws(()=>service.validateSiteToken(token,at),{code:'ATTENDANCE_QR_WRONG_SITE'});process.env.SHIFT_QR_SITE_ID='verification-site-a';}
 }
 const access=gate.createAccess(now.getTime());assert.equal(gate.validAccess(access,now.getTime()),true);assert.equal(gate.validAccess(access,now.getTime()+12*3600000),false);assert.equal(gate.validAccess(access+'tampered',now.getTime()),false);process.env.SHIFT_QR_SITE_ID='verification-site-b';assert.equal(gate.validAccess(access,now.getTime()),false);
 fs.writeFileSync(path.join(out,'decoder-results.json'),JSON.stringify({checks:results.length,rotations:60,decoder:'jsQR 1.4.0 actual rendered branded bytes',logo_region_sha256:logoHash,original_logo_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public/logo.png'))).digest('hex'),real_device:false,results},null,2));
 console.log(`ATTENDANCE_GATE_TEST_OK: ${results.length} actual branded decoder checks, 60 rotations, compact URL, expiry, tampering, wrong site, shared gate with two employee proofs, scoped kiosk expiry`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
