'use strict';
const express=require('express'),path=require('node:path');
const service=require('../services/attendanceDisplayService');
const auth=require('../middleware/auth'),permission=require('../middleware/permissionMiddleware');
const {bodyContract}=require('../middleware/requestContractMiddleware');
const {rateLimitPolicy}=require('../middleware/securityMiddleware');
function privacy(_req,res,next){res.set('Cache-Control','private, no-store, max-age=0').set('Referrer-Policy','no-referrer').set('X-Robots-Tag','noindex, nofollow, noarchive');res.removeHeader('Content-Security-Policy-Report-Only');next();}
function error(res,e){return res.status(e.statusCode||503).json({code:e.code||'ATTENDANCE_DISPLAY_UNAVAILABLE',message:e.statusCode?e.message:'Display temporarily unavailable. Retry shortly.'});}
const display=express.Router();display.use(privacy);
function page(_req,res){res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'").set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');return res.sendFile(path.join(__dirname,'../public/attendance-display.html'));}
display.get('/',page);
display.get('/current',rateLimitPolicy('shift_qr'),async(req,res)=>{try{const value=String(req.headers.authorization||'');return res.json(await service.current({credential:value.startsWith('Bearer ')?value.slice(7):''}));}catch(e){return error(res,e);}});
// This deliberately scoped route accepts no attendance writes or management actions.
display.use((_req,res)=>res.status(404).json({message:'Display route not found'}));
const management=express.Router();management.use(privacy,auth,permission('EDIT_ATTENDANCE'));
management.get('/',async(_req,res)=>{try{return res.json(await service.list());}catch(e){return error(res,e);}});
management.post('/',rateLimitPolicy('shift_qr'),bodyContract(['request_id','label'],{required:['request_id','label']}),async(req,res)=>{try{return res.status(201).json(await service.create({user:req.user,input:req.body,req}));}catch(e){return error(res,e);}});
management.post('/:id/revoke',bodyContract(['request_id','expected_revision','reason'],{required:['request_id','expected_revision','reason']}),async(req,res)=>{try{return res.json(await service.revoke({user:req.user,id:req.params.id,input:req.body,req}));}catch(e){return error(res,e);}});
management.post('/:id/replace',rateLimitPolicy('shift_qr'),bodyContract(['request_id','label','expected_revision','reason'],{required:['request_id','label','expected_revision','reason']}),async(req,res)=>{try{return res.status(201).json(await service.create({user:req.user,replaceId:req.params.id,input:req.body,req}));}catch(e){return error(res,e);}});
module.exports={display,management,privacy,page};
