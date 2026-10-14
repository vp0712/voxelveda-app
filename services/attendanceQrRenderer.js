'use strict';
const QRCode=require('qrcode');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const path=require('node:path');
let logoPromise;
async function renderAttendanceQr(data,scale=8){
  const qr=QRCode.create(data,{errorCorrectionLevel:'H'}),modules=qr.modules.size,margin=4;
  const side=(modules+margin*2)*scale,canvas=createCanvas(side,side),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,side,side);ctx.fillStyle='#071b36';
  for(let row=0;row<modules;row++)for(let col=0;col<modules;col++)if(qr.modules.get(row,col))ctx.fillRect((col+margin)*scale,(row+margin)*scale,scale,scale);
  const logo=await(logoPromise||=loadImage(path.join(__dirname,'../public/logo.png')));
  // Small integer-module plate, centred far from finders and timing lines.
  const plate=Math.max(5,Math.floor(modules*.15)|1)*scale,left=Math.floor((side-plate)/2);
  ctx.fillStyle='#fff';ctx.fillRect(left,left,plate,plate);
  const available=plate-2*scale,ratio=Math.min(available/logo.width,available/logo.height);
  const width=Math.round(logo.width*ratio),height=Math.round(logo.height*ratio);
  ctx.drawImage(logo,Math.floor((side-width)/2),Math.floor((side-height)/2),width,height);
  return {buffer:canvas.toBuffer('image/png'),modules,side,plate};
}
module.exports={renderAttendanceQr};
