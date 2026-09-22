'use strict';

const crypto = require('node:crypto');
const pool = require('../config/db');
const privacy = require('../services/financePrivacyService');
const { logAudit } = require('../services/auditService');
const { FinanceError } = require('../services/financeDomain');
const { normalizeCategory, normalizePreferences } = require('../services/financeControlPreferencesService');

function uid(req){return Number(req.user?.id||0)}
function catUid(){return 'FCAT_'+Date.now()+'_'+crypto.randomBytes(5).toString('hex')}
function audit(req,action,type,id,oldValue,newValue){return {actorId:uid(req),action,module:'finance_control',recordType:type,recordId:String(id),oldValue:oldValue||null,newValue:newValue||null,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null}}
function fail(res,error,message){if(error instanceof FinanceError||error.statusCode)return res.status(error.statusCode||400).json({message:error.message,code:error.code||'FINANCE_CONTROL_ERROR'});console.error(message,error);return res.status(500).json({message,code:'FINANCE_CONTROL_ERROR'})}
function visibleCategorySql(){return "(fc.scope IN ('BUSINESS','BOTH') OR (fc.scope='PERSONAL' AND fc.created_by=?))"}

exports.listCategories=async(req,res)=>{
 try{
  const [rows]=await pool.query(
   `SELECT fc.*,p.name AS parent_name
      FROM finance_categories fc LEFT JOIN finance_categories p ON p.id=fc.parent_category_id
     WHERE ${visibleCategorySql()}
     ORDER BY fc.active DESC,FIELD(fc.scope,'BUSINESS','BOTH','PERSONAL'),COALESCE(p.name,fc.name),fc.name`,[uid(req)]
  );
  const [observed]=await pool.query(
   `SELECT bt.category,bt.ownership_scope,COUNT(*) transaction_count,MAX(bt.transaction_date) last_used
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
     WHERE ${privacy.visibilitySql('ba',req)} AND bt.category IS NOT NULL AND bt.category<>''
     GROUP BY bt.category,bt.ownership_scope ORDER BY transaction_count DESC LIMIT 250`,privacy.visibilityParams(req)
  );
  return res.json({categories:rows,observed_categories:observed,note:'Original bank categories remain immutable source evidence. These records manage current/system classification metadata only.'});
 }catch(error){return fail(res,error,'Failed to load Finance categories.')}
};

exports.createCategory=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const v=normalizeCategory(req.body);await db.beginTransaction();
  if(v.parent_category_id){
   const [[p]]=await db.query(`SELECT * FROM finance_categories fc WHERE fc.id=? AND ${visibleCategorySql()} AND fc.active=1 FOR UPDATE`,[v.parent_category_id,uid(req)]);
   if(!p)throw new FinanceError('Parent category not found.',404,'PARENT_CATEGORY_NOT_FOUND');
  }
  const categoryUid=catUid();
  const [result]=await db.query(
   `INSERT INTO finance_categories(category_uid,name,parent_category_id,scope,colour,icon,gst_default,created_by)
    VALUES (?,?,?,?,?,?,?,?)`,
   [categoryUid,v.name,v.parent_category_id,v.scope,v.colour,v.icon,v.gst_default,uid(req)]
  );
  await logAudit(db,audit(req,'FINANCE_CATEGORY_CREATED','finance_category',result.insertId,null,{category_uid:categoryUid,...v}));
  await db.commit();return res.status(201).json({message:'Finance category created.',id:result.insertId,category_uid:categoryUid});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to create Finance category.')}finally{db.release()}
};

exports.updateCategory=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const id=Number(req.params.id||0),v=normalizeCategory(req.body);await db.beginTransaction();
  const [[row]]=await db.query(`SELECT * FROM finance_categories fc WHERE fc.id=? AND ${visibleCategorySql()} FOR UPDATE`,[id,uid(req)]);
  if(!row)throw new FinanceError('Finance category not found.',404,'FINANCE_CATEGORY_NOT_FOUND');
  if(row.scope==='PERSONAL'&&Number(row.created_by)!==uid(req))throw new FinanceError('Finance category not found.',404,'FINANCE_CATEGORY_NOT_FOUND');
  if(v.parent_category_id===id)throw new FinanceError('A category cannot be its own parent.',400,'INVALID_CATEGORY_PARENT');
  if(v.parent_category_id){
   const [[p]]=await db.query(`SELECT * FROM finance_categories fc WHERE fc.id=? AND ${visibleCategorySql()} AND fc.active=1 FOR UPDATE`,[v.parent_category_id,uid(req)]);
   if(!p)throw new FinanceError('Parent category not found.',404,'PARENT_CATEGORY_NOT_FOUND');
  }
  await db.query(`UPDATE finance_categories SET name=?,parent_category_id=?,scope=?,colour=?,icon=?,gst_default=?,updated_by=? WHERE id=?`,[v.name,v.parent_category_id,v.scope,v.colour,v.icon,v.gst_default,uid(req),id]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_UPDATED','finance_category',id,row,v));await db.commit();
  return res.json({message:'Finance category updated.'});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to update Finance category.')}finally{db.release()}
};

exports.archiveCategory=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const id=Number(req.params.id||0);await db.beginTransaction();
  const [[row]]=await db.query(`SELECT * FROM finance_categories fc WHERE fc.id=? AND ${visibleCategorySql()} FOR UPDATE`,[id,uid(req)]);
  if(!row)throw new FinanceError('Finance category not found.',404,'FINANCE_CATEGORY_NOT_FOUND');
  await db.query('UPDATE finance_categories SET active=0,archived_at=NOW(),archived_by=?,updated_by=? WHERE id=?',[uid(req),uid(req),id]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_ARCHIVED','finance_category',id,row,{active:0}));await db.commit();
  return res.json({message:'Finance category archived. Existing transaction classifications are preserved.'});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to archive Finance category.')}finally{db.release()}
};

exports.restoreCategory=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const id=Number(req.params.id||0);await db.beginTransaction();
  const [[row]]=await db.query(`SELECT * FROM finance_categories fc WHERE fc.id=? AND ${visibleCategorySql()} FOR UPDATE`,[id,uid(req)]);
  if(!row)throw new FinanceError('Finance category not found.',404,'FINANCE_CATEGORY_NOT_FOUND');
  await db.query('UPDATE finance_categories SET active=1,archived_at=NULL,archived_by=NULL,updated_by=? WHERE id=?',[uid(req),id]);
  await logAudit(db,audit(req,'FINANCE_CATEGORY_RESTORED','finance_category',id,row,{active:1}));await db.commit();
  return res.json({message:'Finance category restored.'});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to restore Finance category.')}finally{db.release()}
};

exports.getPreferences=async(req,res)=>{
 try{
  const [[row]]=await pool.query('SELECT * FROM finance_user_preferences WHERE user_id=?',[uid(req)]);
  const dashboardCards=row?(Array.isArray(row.dashboard_cards_json)?row.dashboard_cards_json:(row.dashboard_cards_json?JSON.parse(row.dashboard_cards_json):[])):[];
  return res.json({preferences:row?{...row,dashboard_cards:dashboardCards}:{default_workspace:'ALL',default_account_id:null,reporting_currency:null,default_period:'month',dashboard_cards:[],date_format:'DD/MM/YYYY',number_format:'en-AU'}});
 }catch(error){return fail(res,error,'Failed to load Finance preferences.')}
};

exports.savePreferences=async(req,res)=>{
 const db=await pool.getConnection();
 try{
  const v=normalizePreferences(req.body);await db.beginTransaction();
  if(v.default_account_id)await privacy.assertAccountAccess(db,v.default_account_id,req);
  const [[old]]=await db.query('SELECT * FROM finance_user_preferences WHERE user_id=? FOR UPDATE',[uid(req)]);
  await db.query(
   `INSERT INTO finance_user_preferences(user_id,default_workspace,default_account_id,reporting_currency,default_period,dashboard_cards_json,date_format,number_format)
    VALUES (?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE default_workspace=VALUES(default_workspace),default_account_id=VALUES(default_account_id),
      reporting_currency=VALUES(reporting_currency),default_period=VALUES(default_period),dashboard_cards_json=VALUES(dashboard_cards_json),
      date_format=VALUES(date_format),number_format=VALUES(number_format)`,
   [uid(req),v.default_workspace,v.default_account_id,v.reporting_currency,v.default_period,JSON.stringify(v.dashboard_cards),v.date_format,v.number_format]
  );
  await logAudit(db,audit(req,'FINANCE_PREFERENCES_UPDATED','finance_user_preferences',uid(req),old||null,v));await db.commit();
  return res.json({message:'Finance preferences saved.',preferences:v});
 }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Finance preferences.')}finally{db.release()}
};
