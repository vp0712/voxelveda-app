'use strict';
const imports=require('../services/procurementImportService');
const entries=require('../services/procurementEntryService');
const {sourceArtifact}=require('../services/procurementSourcePdfService');
const {sendPdfResponse}=require('../services/documentPdfService');
function failure(res,error){
 if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'This retry or source record already exists. Refresh its retained state before retrying.',code:'PROCUREMENT_DUPLICATE'});
 if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))return res.status(409).json({message:'Another change is being saved. Refresh this record and retry the same request.',code:'PROCUREMENT_BUSY'});
 const known=error instanceof entries.ProcurementImportError||Boolean(error.statusCode)||String(error.code||'').startsWith('PDF_');
 if(!known)console.error('Procurement import operation failed:',error.code||'IMPORT_INTERNAL_ERROR');
 return res.status(error.statusCode||error.status||500).json({message:known?error.message:'The procurement operation could not complete. Refresh its retained state before retrying.',code:error.code||'PROCUREMENT_IMPORT_FAILED',details:known?error.details||null:null});
}
function handler(fn,map,status=200){return async(req,res)=>{try{return res.status(status).json(await fn(map(req)));}catch(error){return failure(res,error);}};}
exports.upload=async(req,res)=>{
 try{
  const files=[...(req.files?.files||[]),...(req.files?.file||[])];
  const result=await imports.createUpload({user:req.user,files,req});
  void imports.processPendingImports().catch(error=>console.error('Procurement extraction queue failed:',error.code||'IMPORT_WORKER_FAILED'));
  return res.status(result.existing?200:202).json(result);
 }catch(error){return failure(res,error);}
};
exports.list=handler(imports.listImports,req=>({user:req.user,query:req.query}));
exports.detail=handler(imports.getImport,req=>({user:req.user,id:req.params.id,query:req.query}));
exports.preview=handler(imports.previewImport,req=>({user:req.user,id:req.params.id,input:req.body,req}));
exports.editRow=handler(imports.editImportRow,req=>({user:req.user,id:req.params.id,rowId:req.params.rowId,input:req.body,req}));
exports.commit=handler(imports.commitImport,req=>({user:req.user,id:req.params.id,input:req.body,req}));
exports.retry=handler(imports.retryExtraction,req=>({user:req.user,id:req.params.id,input:req.body,req}),202);
exports.sourcePdf=async(req,res)=>{
 try{
  if(Object.keys(req.query||{}).some(key=>key!=='download')||req.query.download!==undefined&&!['0','1'].includes(String(req.query.download)))throw new entries.ProcurementImportError('Source PDF requests support only download=0 or 1.',422,'PDF_QUERY_INVALID');
  const source=await imports.readSourceFile({user:req.user,fileId:req.params.fileId});
  const artifact=await sourceArtifact({buffer:source.buffer,filename:source.filename,sha256:source.sha256});
  return await sendPdfResponse(res,artifact,String(req.query.download)==='1');
 }catch(error){return failure(res,error);}
};
exports.failure=failure;
