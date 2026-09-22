'use strict';

const pool=require('../config/db');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');
const { normalizePreferences }=require('../services/financeUserPreferencesService');

function uid(req){return privacy.userId(req)}
function fail(res,error,message){
  if(error?.statusCode)return res.status(error.statusCode).json({message:error.message,code:error.code||'FINANCE_PREFERENCES_ERROR'});
  console.error(message,error);return res.status(500).json({message,code:'FINANCE_PREFERENCES_ERROR'});
}
function audit(req,oldValue,newValue){
  return {actorId:uid(req),action:'FINANCE_PREFERENCES_UPDATED',module:'finance_preferences',recordType:'finance_user_preferences',
    recordId:String(uid(req)),oldValue:oldValue||null,newValue:newValue||null,requestId:req.requestId||null,
    sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
function cards(value){
  if(Array.isArray(value))return value;
  if(!value)return [];
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[]}catch{return []}
}

exports.get=async(req,res)=>{
  try{
    const [[row]]=await pool.query('SELECT * FROM finance_user_preferences WHERE user_id=?',[uid(req)]);
    return res.json({preferences:row?{
      default_workspace:row.default_workspace,
      default_account_id:row.default_account_id,
      reporting_currency:row.reporting_currency,
      default_period:row.default_period,
      dashboard_cards:cards(row.dashboard_cards_json),
      date_format:row.date_format,
      number_format:row.number_format
    }:{
      default_workspace:'ALL',default_account_id:null,reporting_currency:null,default_period:'month',
      dashboard_cards:[],date_format:'DD/MM/YYYY',number_format:'en-AU'
    }});
  }catch(error){return fail(res,error,'Failed to load Finance preferences.')}
};

exports.save=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const value=normalizePreferences(req.body);
    await db.beginTransaction();
    if(value.default_account_id)await privacy.assertAccountAccess(db,value.default_account_id,req,{forUpdate:false});
    const [[old]]=await db.query('SELECT * FROM finance_user_preferences WHERE user_id=? FOR UPDATE',[uid(req)]);
    await db.query(
      `INSERT INTO finance_user_preferences
       (user_id,default_workspace,default_account_id,reporting_currency,default_period,dashboard_cards_json,date_format,number_format)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE default_workspace=VALUES(default_workspace),default_account_id=VALUES(default_account_id),
       reporting_currency=VALUES(reporting_currency),default_period=VALUES(default_period),dashboard_cards_json=VALUES(dashboard_cards_json),
       date_format=VALUES(date_format),number_format=VALUES(number_format)`,
      [uid(req),value.default_workspace,value.default_account_id,value.reporting_currency,value.default_period,JSON.stringify(value.dashboard_cards),value.date_format,value.number_format]
    );
    await logAudit(db,audit(req,old?{...old,dashboard_cards_json:undefined}:null,value));
    await db.commit();
    return res.json({message:'Finance preferences saved.',preferences:value});
  }catch(error){await db.rollback().catch(()=>{});return fail(res,error,'Failed to save Finance preferences.')}finally{db.release()}
};
