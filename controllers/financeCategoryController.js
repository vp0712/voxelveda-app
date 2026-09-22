'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const privacy=require('../services/financePrivacyService');
const { FinanceError }=require('../services/financeDomain');
const { logAudit }=require('../services/auditService');
const { ensureFinanceSchema }=require('../services/financeSchema');

const SCOPES=new Set(['PERSONAL','BUSINESS','BOTH']);
const GST_DEFAULTS=new Set(['REVIEW','GST_ON_EXPENSES','GST_ON_INCOME','GST_FREE','INPUT_TAXED','NO_GST','OUT_OF_SCOPE']);

function uid(){return `CAT_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`}
function userId(req){return privacy.userId(req)}
function fail(res,error,message){
 if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
 if(error?.code==='ER_DUP_ENTRY')return res.status(409).json({message:'A matching category already exists.',code:'DUPLICATE_CATEGORY'});
 console.error(message,error);return res.status(500).json({message,code:'FINANCE_CATEGORY_ERROR'});
}
function audit(req,action,id,oldValue,newValue){
 return {actorId:userId(req),action,module:'finance_categories',recordType:'finance_system_category',recordId:String(id),
  oldValue:oldValue||null,newValue:newValue||null,requestId:req.requestId||null,sessionId:req.session?.id||null,
  ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function normalize(body){
 const name=String(body.name||'').trim().slice(0,120);
 if(name.length<2)throw new FinanceError('Category name must be at least 2 characters.',400,'CATEGORY_NAME_REQUIRED');
 const scope=String(body.scope||'BOTH').trim().toUpperCase();
 if(!SCOPES.has(scope))throw new FinanceError('Category scope must be Personal, Business or Both.',400,'INVALID_CATEGORY_SCOPE');
 const gstDefault=String(body.gst_default||'REVIEW').trim().toUpperCase();
 if(!GST_DEFAULTS.has(gstDefault))throw new FinanceError('Choose a supported GST default.',400,'INVALID_CATEGORY_GST_DEFAULT');
 const parentId=body.parent_id?Number(body.parent_id):null;
 if(parentId!==null&&!Number.isInteger(parentId))throw new FinanceError('Invalid parent category.',400,'INVALID_PARENT_CATEGORY');
 const icon=String(body.icon||'').trim().slice(0,40)||null;
 const color=String(body.color||'').trim().slice(0,24)||null;
 if(color&&!/^#[0-9a-f]{6}$/i.test(color))throw new FinanceError('Category colour must be a six-digit hex colour.',400,'INVALID_CATEGORY_COLOR');
 return {name,scope,gst_default:gstDefault,parent_id:parentId,icon,color};
}
function visibilitySql(req,alias='c'){
 return `((${alias}.scope IN ('BUSINESS','BOTH') AND ${alias}.owner_user_id IS NULL) OR (${alias}.scope='PERSONAL' AND ${alias}.owner_user_id=?))`;
}
function visibilityParams(req){return [userId(req)]}

exports.list=async(req,res)=>{
 try{
  await ensureFinanceSchema();
  const includeArchived=String(req.query.include_archived||'').toLowerCase()==='true';
  const clauses=[visibilitySql(req,'c')];const params=visibilityParams(req);
  if(!includeArchived)clauses.push('c.active=1 AND c.archived_at IS NULL');
  const [rows]=await pool.query(
   `SELECT c.id,c.category_uid,c.name,c.parent_id,p.name AS parent_name,c.scope,c.icon,c.color,c.gst_default,
           c.active,c.archived_at,c.created_by,c.created_at,c.updated_at
      FROM finance_system_categories c
      LEFT JOIN finance_system_categories p ON p.id=c.parent_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY c.active DESC,COALESCE(p.name,c.name),c.parent_id IS NOT NULL,c.name`,params);
  return res.json({
   categories:rows,
   semantic_note:'System categories are editable classification. Original bank categories remain immutable source evidence.',
   gst_note:'GST defaults are workflow defaults only and do not override accountant/tax review.'
  });
 }catch(error){return fail(res,error,'Failed to load Finance categories.')}
};

exports.save=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  await ensureFinanceSchema();const values=normalize(req.body),id=Number(req.body.id||0);
  await db.beginTransaction();
  if(values.parent_id){
   const [[parent]]=await db.query(`SELECT id,scope,owner_user_id FROM finance_system_categories WHERE id=? AND ${visibilitySql(req,'finance_system_categories')} AND active=1 FOR UPDATE`,[values.parent_id,...visibilityParams(req)]);
   if(!parent)throw new FinanceError('Parent category is not available to this user.',404,'PARENT_CATEGORY_NOT_FOUND');
   if(values.scope==='BUSINESS'&&parent.scope==='PERSONAL')throw new FinanceError('Business categories cannot use a Personal parent.',400,'CATEGORY_PARENT_SCOPE_MISMATCH');
  }
  const owner=values.scope==='PERSONAL'?userId(req):null;
  if(id){
   const [[existing]]=await db.query(`SELECT * FROM finance_system_categories c WHERE c.id=? AND ${visibilitySql(req,'c')} FOR UPDATE`,[id,...visibilityParams(req)]);
   if(!existing)throw new FinanceError('Category not found.',404,'CATEGORY_NOT_FOUND');
   if(existing.scope!=='PERSONAL'&&values.scope==='PERSONAL')throw new FinanceError('Shared business categories cannot be converted into private personal categories.',409,'CATEGORY_SCOPE_CONVERSION_BLOCKED');
   if(existing.scope==='PERSONAL'&&Number(existing.owner_user_id)!==userId(req))throw new FinanceError('Category is not available to this user.',404,'CATEGORY_NOT_FOUND');
   await db.query(
    `UPDATE finance_system_categories SET name=?,parent_id=?,scope=?,owner_user_id=?,icon=?,color=?,gst_default=?,active=1,archived_at=NULL,archived_by=NULL,updated_by=? WHERE id=?`,
    [values.name,values.parent_id,values.scope,owner,values.icon,values.color,values.gst_default,userId(req),id]);
   await logAudit(db,audit(req,'FINANCE_CATEGORY_UPDATED',id,existing,{...values,owner_user_id:owner}));
   await db.commit();return res.json({message:'Finance category updated.',id});
  }
  const categoryUid=uid();
  const [insert]=await db.query(
   `INSERT INTO finance_system_categories (category_uid,name,parent_id,scope,owner_user_id,icon,color,gst_default,created_by,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
   [categoryUid,values.name,values.parent_id,values.scope,owner,values.icon,values.color,values.gst_default,userId(req),userId(req)]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_CREATED',insert.insertId,null,{category_uid:categoryUid,...values,owner_user_id:owner}));
  await db.commit();return res.status(201).json({message:'Finance category created.',id:insert.insertId,category_uid:categoryUid});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Finance category.')}finally{db.release()}
};

exports.archive=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  await ensureFinanceSchema();const id=Number(req.params.id||0);await db.beginTransaction();
  const [[existing]]=await db.query(`SELECT * FROM finance_system_categories c WHERE c.id=? AND ${visibilitySql(req,'c')} FOR UPDATE`,[id,...visibilityParams(req)]);
  if(!existing)throw new FinanceError('Category not found.',404,'CATEGORY_NOT_FOUND');
  const [[children]]=await db.query('SELECT COUNT(*) AS count FROM finance_system_categories WHERE parent_id=? AND active=1',[id]);
  if(Number(children.count||0)>0)throw new FinanceError('Archive or move active child categories first.',409,'CATEGORY_HAS_ACTIVE_CHILDREN');
  await db.query('UPDATE finance_system_categories SET active=0,archived_at=NOW(),archived_by=?,updated_by=? WHERE id=?',[userId(req),userId(req),id]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_ARCHIVED',id,existing,{active:0}));
  await db.commit();return res.json({message:'Finance category archived. Existing transaction classifications remain unchanged.'});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to archive Finance category.')}finally{db.release()}
};

exports.restore=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  await ensureFinanceSchema();const id=Number(req.params.id||0);await db.beginTransaction();
  const [[existing]]=await db.query(`SELECT * FROM finance_system_categories c WHERE c.id=? AND ${visibilitySql(req,'c')} FOR UPDATE`,[id,...visibilityParams(req)]);
  if(!existing)throw new FinanceError('Category not found.',404,'CATEGORY_NOT_FOUND');
  await db.query('UPDATE finance_system_categories SET active=1,archived_at=NULL,archived_by=NULL,updated_by=? WHERE id=?',[userId(req),id]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_RESTORED',id,existing,{active:1}));
  await db.commit();return res.json({message:'Finance category restored.'});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to restore Finance category.')}finally{db.release()}
};
