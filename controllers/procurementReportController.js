'use strict';
const reports = require('../services/procurementReportService');
const { sendPdfResponse } = require('../services/documentPdfService');
const { queueDocumentEmail,deliveryMessage } = require('../services/documentDeliveryService');
const { validateRecipients } = require('../services/emailService');
const { hasPermission } = require('../services/authorizationService');
const { logAudit } = require('../services/auditService');
function failure(res,error) { return res.status(error.status||error.statusCode||422).json({message:error.status||error.statusCode||String(error.code||'').startsWith('PDF_')?error.message:'The procurement document could not be processed. Review its failure and retry.',code:error.code||'PROCUREMENT_DOCUMENT_FAILED',snapshot_id:error.snapshot_id||null,document_request_id:error.document_request_id||null,email_sent:false}); }
exports.create = async (req,res) => {
  try { const snapshot=await reports.createSnapshot({user:req.user,input:req.body,req});return res.status(snapshot.generation_status==='VALIDATED'?201:202).json(snapshot); }
  catch(error) {return failure(res,error);}
};
exports.metadata = async (req,res) => {
  try { return res.json(reports.metadata(await reports.getSnapshot({user:req.user,snapshotId:req.params.id}))); }
  catch(error) { return failure(res,error); }
};
exports.pdf = async (req,res) => {
  try { if(req.query.download!==undefined&&!['0','1'].includes(String(req.query.download)))return res.status(422).json({message:'Download must be 0 or 1.'});const row=await reports.getSnapshot({user:req.user,snapshotId:req.params.id}),artifact=await reports.snapshotArtifact(row);return await sendPdfResponse(res,artifact,String(req.query.download)==='1'); }
  catch(error) { return failure(res,error); }
};
exports.send = async (req,res) => {
  try {
    if(!hasPermission(req.user,'SEND_COMPANY_EMAIL'))return res.status(403).json({message:'Company document sending is not permitted.',code:'PERMISSION_DENIED'});
    const to=validateRecipients(req.body.to,'to');if(to.length!==1)return res.status(422).json({message:'Enter one explicit document recipient. No automatic copies are added.'});
    const row=await reports.getSnapshot({user:req.user,snapshotId:req.params.id}),artifact=await reports.snapshotArtifact(row),data=JSON.parse(row.document_json);
    const delivery=await queueDocumentEmail({module:'procurement',recordId:`report:${row.id}`,data,to,subject:`Voxel Veda procurement report ${row.reference}`,text:`The validated procurement report ${row.reference} is attached as a PDF. This frozen report reflects the source and version shown in the document.`,createdBy:req.user.id,validatedArtifact:artifact,
      beforeQueue:async conn=>{const saved=await reports.getSnapshot({user:req.user,snapshotId:row.id,db:conn});if(saved.pdf_sha256!==row.pdf_sha256 || saved.source_sha256!==row.source_sha256 || saved.generation_status!=='VALIDATED')throw Object.assign(new Error('The report snapshot changed or is no longer validated. Review before retry.'),{code:'PDF_SNAPSHOT_MISMATCH'});},
      afterQueue:async(conn,queueId)=>logAudit(conn,{actorId:req.user.id,action:'PROCUREMENT_REPORT_EMAIL_QUEUED',module:'procurement',recordType:'report_snapshot',recordId:row.id,newValue:{reference:row.reference,source_hash:row.source_sha256,pdf_hash:row.pdf_sha256,email_queue_id:queueId},ipAddress:req.ip,userAgent:req.get?.('user-agent')})});
    return res.json({...reports.metadata(row),...delivery,message:deliveryMessage(delivery,'Procurement report'),email_sent:false});
  } catch(error) { return failure(res,error); }
};
exports._test = {failure};
