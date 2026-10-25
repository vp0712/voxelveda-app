'use strict';
const registers = require('../services/qmsRegisterService');
const { sendPdfResponse } = require('../services/documentPdfService');
const {hasAnyPermission}=require('../services/authorizationService');
exports.catalog = (req,res,next) => { try { return res.json({registers:registers.catalog(req.user),capabilities:{generate_alerts:hasAnyPermission(req.user,['MANAGE_QMS','EDIT_COMPLIANCE']),start_drill:hasAnyPermission(req.user,['MANAGE_SAFETY','MANAGE_QMS','EDIT_COMPLIANCE']),import_legacy:hasAnyPermission(req.user,['CREATE_QMS_RECORD','EDIT_QMS_RECORD','MANAGE_QMS','EDIT_COMPLIANCE'])}}); } catch(error) { return next(error); } };
exports.list = async(req,res,next) => { try { return res.json(await registers.listRegister(req,String(req.params.register || ''))); } catch(error) { return next(error); } };
exports.pdf = async(req,res,next) => {
  try {
    const artifact=await registers.reportArtifact(req,String(req.params.register || ''));
    res.setHeader('X-Document-Source-SHA256',artifact.sourceHash);
    res.setHeader('X-Document-SHA256',artifact.validation.sha256);
    res.setHeader('X-Document-Record-Count',String(artifact.sourceCount));
    return await sendPdfResponse(res,artifact,String(req.query.download || '0') === '1');
  } catch(error) { return next(error); }
};

