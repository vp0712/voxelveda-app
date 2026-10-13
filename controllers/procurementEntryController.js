'use strict';
const entries=require('../services/procurementEntryService');
const {failure}=require('./procurementImportController');
function handler(fn,map,status=200){return async(req,res)=>{try{return res.status(status).json(await fn(map(req)));}catch(error){return failure(res,error);}};}
exports.list=handler(entries.listEntries,req=>({user:req.user,filters:req.query}));
exports.detail=handler(async options=>({entry:await entries.getEntry(options)}),req=>({user:req.user,id:req.params.id}));
exports.create=handler(entries.createEntry,req=>({user:req.user,input:req.body,req}),201);
exports.edit=handler(entries.editEntry,req=>({user:req.user,id:req.params.id,input:req.body,req}));
exports.archive=handler(entries.archiveEntry,req=>({user:req.user,id:req.params.id,input:req.body,req}));
exports.restore=handler(entries.archiveEntry,req=>({user:req.user,id:req.params.id,input:req.body,req,restore:true}));
