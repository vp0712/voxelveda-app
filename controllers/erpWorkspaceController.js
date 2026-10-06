'use strict';
const pool=require('../config/db');
const service=require('../services/erpWorkspaceService');
function handler(fn,status=200) { return async(req,res,next)=>{ try { res.setHeader('Cache-Control','private, no-store'); return res.status(status).json(await fn(req)); } catch(error) { return next(error); } }; }
exports.workspace=handler(req=>service.workspace(pool,req.user));
exports.createCampaign=handler(req=>service.saveCampaign(pool,req),201);
exports.updateCampaign=handler(req=>service.saveCampaign(pool,req,serviceId(req.params.id)));
exports.createJob=handler(req=>service.createJob(pool,req),201);
exports.scheduleOperation=handler(req=>service.scheduleOperation(pool,req,serviceId(req.params.id)),201);
function serviceId(value) { if(!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1) throw new service.ErpError('Record ID is invalid.'); return Number(value); }
