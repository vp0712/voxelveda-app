'use strict';
const express=require('express'),multer=require('multer'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {requireAnyPermission}=require('../middleware/authorizationMiddleware');
const {bodyContract}=require('../middleware/requestContractMiddleware');
const imports=require('../controllers/procurementImportController'),entries=require('../controllers/procurementEntryController'),reports=require('../controllers/procurementReportController');
const router=express.Router();
router.use(requireAnyPermission('VIEW_PROCUREMENT'));
const mutate=requireAnyPermission('IMPORT_PROCUREMENT','CREATE_PURCHASE_REQUISITION','MANAGE_PROCUREMENT_RECORDS');
const uploadDir=path.join(__dirname,'..','uploads','procurement-import-staging');fs.mkdirSync(uploadDir,{recursive:true,mode:0o700});
const storage=multer.diskStorage({destination:uploadDir,filename:(_req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname||'').toLowerCase().replace(/[^a-z0-9.]/g,''))});
const upload=multer({storage,limits:{files:10,fileSize:8*1024*1024,fields:0,parts:10}}).fields([{name:'files',maxCount:10},{name:'file',maxCount:1}]);
function uploadFiles(req,res,next){
 upload(req,res,async error=>{
  if(!error)return next();
  const files=Array.isArray(req.files)?req.files:Object.values(req.files||{}).flat();for(const file of files)if(file.path)await fs.promises.unlink(file.path).catch(()=>{});
  return res.status(error.code==='LIMIT_FILE_SIZE'?413:422).json({message:'Choose at most ten supported source files, each no larger than 8 MiB. This upload request was not accepted.',code:error.code||'IMPORT_UPLOAD_INVALID',accepted_files:0});
 });
}
router.post('/imports',mutate,uploadFiles,imports.upload);
router.get('/imports',imports.list);
router.get('/imports/files/:fileId/pdf',imports.sourcePdf);
router.get('/imports/:id',imports.detail);
router.post('/imports/:id/preview',mutate,bodyContract(['expected_revision','file_id','sheet_name','header_row','mapping','classification','date_order'],{required:['expected_revision','mapping','classification']}),imports.preview);
router.patch('/imports/:id/rows/:rowId',mutate,bodyContract(['expected_revision','values','reviewed'],{required:['expected_revision','values','reviewed']}),imports.editRow);
router.post('/imports/:id/commit',mutate,bodyContract(['expected_revision','preview_token','row_ids','reviewed_row_ids'],{required:['expected_revision','preview_token']}),imports.commit);
router.post('/imports/:id/retry-extraction',mutate,bodyContract(['expected_revision','reason'],{required:['expected_revision','reason']}),imports.retry);
const fields=['classification','title','reference','supplier_id','supplier_name','date','due_date','currency','description','item_code','quantity','unit','unit_price','tax_rate','net','tax','total','notes','category','priority','phase'];
router.get('/entries',entries.list);
router.post('/entries',mutate,bodyContract([...fields,'request_key','source_file_id'],{required:['classification','description','quantity']}),entries.create);
router.get('/entries/:id',entries.detail);
router.patch('/entries/:id',mutate,bodyContract([...fields,'expected_revision','reason'],{required:['expected_revision','classification','description','quantity']}),entries.edit);
router.post('/entries/:id/archive',mutate,bodyContract(['expected_revision','reason'],{required:['expected_revision','reason']}),entries.archive);
router.post('/entries/:id/restore',mutate,bodyContract(['expected_revision','reason'],{required:['expected_revision']}),entries.restore);
router.post('/reports/snapshots',bodyContract(['type','filters','ids','record_id','batch_id','source'],{required:['type']}),reports.create);
router.get('/reports/snapshots/:id',reports.metadata);
router.get('/reports/snapshots/:id/pdf',reports.pdf);
router.post('/reports/snapshots/:id/send',requireAnyPermission('SEND_COMPANY_EMAIL'),bodyContract(['to'],{required:['to']}),reports.send);
module.exports=router;
