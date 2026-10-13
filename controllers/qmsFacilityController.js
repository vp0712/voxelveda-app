const pool=require('../config/db');
const {ensureQmsEnterpriseCompletionSchema}=require('../services/qmsEnterpriseCompletionSchema');
const {logAudit}=require('../services/auditService');
const crypto=require('node:crypto');
const {quantityUnits}=require('../utils/quantity');
const {dateOnly}=require('../utils/dateOnly');
const {getAuthorisedDocument}=require('../services/documentSecurityService');
function actor(req){return Number(req.user?.id||req.user?.user_id||0)||null}function clean(v,m=1000){return String(v??'').trim().slice(0,m)}function audit(req){return{actorId:actor(req),ipAddress:req.ip,userAgent:req.get('user-agent'),requestId:req.id||req.get('x-request-id')||null,sessionId:req.session?.id||null}}
async function addSds(req,res,next){
 let connection;
 try {
  await ensureQmsEnterpriseCompletionSchema();
  const chemicalId=Number(req.params.id),version=clean(req.body.version_label,80);
  if(!Number.isSafeInteger(chemicalId)||chemicalId<=0)return res.status(400).json({message:'Choose a valid chemical product.'});
  if(!version)return res.status(400).json({message:'version_label is required.',fields:{version_label:'Enter the SDS version'}});
  const issue=req.body.issue_date?dateOnly(req.body.issue_date):null,due=req.body.review_due?dateOnly(req.body.review_due):null;
  if((req.body.issue_date&&!issue)||(req.body.review_due&&!due)||(issue&&due&&due<issue))return res.status(400).json({message:'Enter valid SDS dates with review due on or after the issue date.'});
  const access=await getAuthorisedDocument(req.user,req.body.secure_document_id);
  if(access.status!==200)return res.status(access.status).json({message:'The SDS secure document is unavailable or access is denied.',code:'SDS_DOCUMENT_UNAVAILABLE'});
  if(req.body.file_hash&&String(req.body.file_hash).toLowerCase()!==String(access.document.content_sha256).toLowerCase())return res.status(409).json({message:'The SDS hash does not match the uploaded document.',code:'DOCUMENT_HASH_MISMATCH'});
  connection=await pool.getConnection();await connection.beginTransaction();
  const [[chemical]]=await connection.query('SELECT * FROM chemical_products WHERE id=? FOR UPDATE',[chemicalId]);
  if(!chemical){await connection.rollback();return res.status(404).json({message:'Chemical product not found.'});}
  const currentAccess=await getAuthorisedDocument(req.user,access.document.id,connection);
  if(currentAccess.status!==200){await connection.rollback();return res.status(currentAccess.status).json({message:'The SDS secure document is no longer available.'});}
  const [[current]]=await connection.query("SELECT * FROM sds_versions WHERE chemical_id=? AND status='CURRENT' ORDER BY id DESC LIMIT 1",[chemicalId]);
  if(current&&String(current.secure_document_id)===String(access.document.id)&&current.version_label===version){await connection.commit();return res.json({id:current.id,status:'CURRENT',unchanged:true});}
  await connection.query("UPDATE sds_versions SET status='SUPERSEDED' WHERE chemical_id=? AND status='CURRENT'",[chemicalId]);
  const [result]=await connection.query("INSERT INTO sds_versions(chemical_id,version_label,issue_date,review_due,secure_document_id,file_hash,status,created_by) VALUES(?,?,?,?,?,?,'CURRENT',?)",[chemicalId,version,issue,due,access.document.id,access.document.content_sha256,actor(req)]);
  await logAudit(connection,{...audit(req),action:'SDS_VERSION_REGISTERED',module:'QMS',recordType:'CHEMICAL',recordId:chemical.chemical_code,newValue:{version,secureDocumentId:access.document.id,priorVersionId:current?.id||null}});
  await connection.commit();return res.status(201).json({id:result.insertId,status:'CURRENT'});
 }catch(error){if(connection)await connection.rollback().catch(()=>{});return next(error);}finally{if(connection)connection.release();}
}

async function chemicalTransaction(req,res,next){
 let connection;
 try{
  await ensureQmsEnterpriseCompletionSchema();
  const chemicalId=Number(req.params.id),type=clean(req.body.transaction_type,20).toUpperCase();
  if(!Number.isSafeInteger(chemicalId)||chemicalId<=0)return res.status(400).json({message:'Choose a valid chemical product.'});
  if(!['RECEIPT','USE','ADJUSTMENT','DISPOSAL'].includes(type))return res.status(400).json({message:'Invalid transaction_type.',fields:{transaction_type:'Choose receipt, use, adjustment or disposal'}});
  const units=quantityUnits(req.body.quantity);
  if(units===null)return res.status(400).json({message:'Enter a positive quantity with at most three decimal places.',fields:{quantity:'Enter a positive finite quantity with at most three decimal places'}});
  const delta=type==='RECEIPT'?units:type==='ADJUSTMENT'?quantityUnits(req.body.adjustment_delta??req.body.quantity,{signed:true}):-units;
  if(delta===null||Math.abs(delta)!==units)return res.status(400).json({message:'Adjustment must be a finite signed quantity matching its declared quantity.',fields:{adjustment_delta:'Enter the signed adjustment with at most three decimal places'}});
  const reference=clean(req.body.reference,255)||null,rawKey=String(req.get('Idempotency-Key')||'').trim();
  if(rawKey.length>200||/[\x00-\x1f\x7f]/.test(rawKey))return res.status(400).json({message:'Invalid retry key.'});
  const requestKey=rawKey?crypto.createHash('sha256').update(JSON.stringify([chemicalId,actor(req),rawKey])).digest('hex'):null;
  const requestHash=crypto.createHash('sha256').update(JSON.stringify([type,units,delta,reference])).digest('hex');
  connection=await pool.getConnection();await connection.beginTransaction();
  const [[chemical]]=await connection.query('SELECT * FROM chemical_products WHERE id=? FOR UPDATE',[chemicalId]);
  if(!chemical){await connection.rollback();return res.status(404).json({message:'Chemical product not found.'});}
  if(requestKey){const [[prior]]=await connection.query('SELECT id,request_hash FROM chemical_transactions WHERE request_key=?',[requestKey]);if(prior){if(prior.request_hash!==requestHash){await connection.rollback();return res.status(409).json({message:'This retry key belongs to a different chemical transaction.',code:'IDEMPOTENCY_CONFLICT'});}await connection.commit();return res.json({id:chemical.id,transaction_id:prior.id,current_quantity:Number(chemical.current_quantity),unchanged:true});}}
  const current=quantityUnits(chemical.current_quantity,{allowZero:true});
  if(current===null){await connection.rollback();return res.status(409).json({message:'The retained chemical quantity requires review before another change.',code:'QUANTITY_REVIEW_REQUIRED'});}
  if(req.body.expected_quantity!==undefined&&quantityUnits(req.body.expected_quantity,{allowZero:true})!==current){await connection.rollback();return res.status(409).json({message:'Chemical quantity has changed. Refresh this record before saving.',code:'QUANTITY_CONFLICT'});}
  const nextUnits=current+delta;
  if(nextUnits<0||nextUnits>=100000000000000){await connection.rollback();return res.status(409).json({message:'Chemical transaction would create an invalid stock quantity.',code:'INVALID_STOCK_CHANGE'});}
  if(['QUARANTINED','DISCONTINUED'].includes(chemical.status)&&type!=='DISPOSAL'){await connection.rollback();return res.status(409).json({message:'This chemical may only be disposed while quarantined or discontinued.'});}
  const nextQty=nextUnits/1000;
  const [result]=await connection.query('INSERT INTO chemical_transactions(chemical_id,transaction_type,quantity,reference,performed_by,request_key,request_hash) VALUES(?,?,?,?,?,?,?)',[chemical.id,type,(type==='ADJUSTMENT'?delta:units)/1000,reference,actor(req),requestKey,requestHash]);
  await connection.query('UPDATE chemical_products SET current_quantity=? WHERE id=?',[nextQty,chemical.id]);
  await logAudit(connection,{...audit(req),action:'CHEMICAL_QUANTITY_CHANGED',module:'QMS',recordType:'CHEMICAL',recordId:chemical.chemical_code,oldValue:{quantity:current/1000},newValue:{quantity:nextQty,type,transactionId:result.insertId}});
  await connection.commit();return res.json({id:chemical.id,transaction_id:result.insertId,current_quantity:nextQty,internal_review_required:chemical.maximum_quantity!==null&&nextQty>Number(chemical.maximum_quantity)});
 }catch(error){if(connection)await connection.rollback().catch(()=>{});return next(error);}finally{if(connection)connection.release();}
}
async function addReviewAction(req,res,next){try{await ensureQmsEnterpriseCompletionSchema();const [[review]]=await pool.query('SELECT * FROM management_reviews WHERE id=?',[req.params.id]);if(!review)return res.status(404).json({message:'Management review not found.'});const text=clean(req.body.action_text,4000);if(!text)return res.status(400).json({message:'action_text is required.'});const [r]=await pool.query('INSERT INTO management_review_actions(review_id,action_text,owner_user_id,due_date) VALUES(?,?,?,?)',[review.id,text,req.body.owner_user_id||null,req.body.due_date||null]);return res.status(201).json({id:r.insertId,status:'OPEN'})}catch(e){return next(e)}}
async function closeManagementReview(req,res,next){try{await ensureQmsEnterpriseCompletionSchema();const [[review]]=await pool.query('SELECT * FROM management_reviews WHERE id=?',[req.params.id]);if(!review)return res.status(404).json({message:'Management review not found.'});const [open]=await pool.query("SELECT id FROM management_review_actions WHERE review_id=? AND status NOT IN('COMPLETE','CANCELLED')",[review.id]);if(open.length&&!req.body.allow_open_actions)return res.status(409).json({message:'Open management-review actions remain. Complete them or explicitly confirm they remain tracked.'});await pool.query("UPDATE management_reviews SET status='CLOSED',held_at=COALESCE(held_at,NOW()),decisions_json=? WHERE id=?",[JSON.stringify(req.body.decisions||{}),review.id]);await logAudit(pool,{...audit(req),action:'MANAGEMENT_REVIEW_CLOSED',module:'QMS',recordType:'MANAGEMENT_REVIEW',recordId:review.review_no,newValue:{openActions:open.length}});return res.json({id:review.id,status:'CLOSED',open_actions:open.length})}catch(e){return next(e)}}
module.exports={addSds,chemicalTransaction,addReviewAction,closeManagementReview};
