'use strict';

const pool=require('../config/db');
const privacy=require('../services/financePrivacyService');
const { logAudit }=require('../services/auditService');
const { normalizePreferences }=require('../services/financeUserPreferencesService');

function userId(req){return Number(req.user?.id||req.user?.user_id||0)}
function fail(res,error,message){
  if(error?.statusCode)return res.status(error.statusCode).json({message:error.message,code:error.code||'FINANCE_PREFERENCES_ERROR'});
  console.error(message,error);
  return res.status(500).json({message,code:'FINANCE_PREFERENCES_ERROR'});
}
function audit(req,oldValue,newValue){
  return {actorId:userId(req),action:'FINANCE_PREFERENCES_UPDATED',module:'finance_preferences',recordType:'finance_user_preferences',recordId:String(userId(req)),oldValue:oldValue||null,newValue,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}

exports.get=async(req,res)=>{
  try{
    const [[row]]=await pool.query('SELECT * FROM finance_user_preferences WHERE user_id=?',[userId(req)]);
    const preferences=row?{
      ...row,
      dashboard_cards:row.dashboard_cards_json?JSON.parse(row.dashboard_cards_json):[]
    }:{
      default_workspace:'ALL',default_account_id:null,reporting_currency:null,default_period:'month',
      dashboard_cards:[],date_format:'DD/MM/YYYY',number_format:'en-AU'
    };
    return res.json({preferences});
  }catch(error){return fail(res,error,'Failed to load Finance preferences.')}
};

exports.save=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    const values=normalizePreferences(req.body);
    await db.beginTransaction();
    if(values.default_account_id)await privacy.assertAccountAccess(db,values.default_account_id,req);
    const [[old]]=await db.query('SELECT * FROM finance_user_preferences WHERE user_id=? FOR UPDATE',[userId(req)]);
    await db.query(
      `INSERT INTO finance_user_preferences
       (user_id,default_workspace,default_account_id,reporting_currency,default_period,dashboard_cards_json,date_format,number_format)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         default_workspace=VALUES(default_workspace),
         default_account_id=VALUES(default_account_id),
         reporting_currency=VALUES(reporting_currency),
         default_period=VALUES(default_period),
         dashboard_cards_json=VALUES(dashboard_cards_json),
         date_format=VALUES(date_format),
         number_format=VALUES(number_format)`,
      [userId(req),values.default_workspace,values.default_account_id,values.reporting_currency,values.default_period,JSON.stringify(values.dashboard_cards),values.date_format,values.number_format]
    );
    await logAudit(db,audit(req,old||null,values));
    await db.commit();
    return res.json({message:'Finance preferences saved.',preferences:values});
  }catch(error){
    await db.rollback().catch(()=>{});
    return fail(res,error,'Failed to save Finance preferences.');
  }finally{db.release()}
};
