'use strict';

const crypto=require('node:crypto');
const pool=require('../config/db');
const { logAudit }=require('../services/auditService');

function userId(req){return Number(req.user?.id||req.user?.user_id||0)}
function currency(value){
  const code=String(value||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(code))throw Object.assign(new Error('Enter a valid three-letter currency code.'),{statusCode:400,code:'INVALID_FX_CURRENCY'});
  return code;
}
function effectiveDate(value){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text+'T00:00:00Z')))throw Object.assign(new Error('Enter a valid FX effective date.'),{statusCode:400,code:'INVALID_FX_DATE'});
  return text;
}
function rateValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||n>1000000000)throw Object.assign(new Error('FX rate must be greater than zero.'),{statusCode:400,code:'INVALID_FX_RATE'});
  return Number(n.toFixed(10));
}
function sourceNote(value){return String(value||'').trim().slice(0,255)||null}
function fail(res,error,fallback){
  const status=Number(error?.statusCode||error?.status)||500;
  if(status>=500)console.error(fallback,error);
  return res.status(status).json({message:error?.message||fallback,code:error?.code||'FINANCE_FX_ERROR'});
}
function audit(req,action,recordId,newValue){
  return {actorId:userId(req),action,module:'finance_fx',recordType:'finance_fx_rate',recordId:String(recordId||''),newValue:newValue||null,requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}

exports.list=async(req,res)=>{
  try{
    const includeArchived=String(req.query.include_archived||'').toLowerCase()==='true';
    const [rows]=await pool.query(
      `SELECT rate_uid,from_currency,to_currency,rate,effective_date,source_note,active,created_at,updated_at
         FROM finance_fx_rates
        WHERE user_id=? ${includeArchived?'':"AND active=1"}
        ORDER BY effective_date DESC,from_currency,to_currency,id DESC LIMIT 500`,
      [userId(req)]
    );
    return res.json({
      rates:rows.map(row=>({...row,rate:Number(row.rate)})),
      rule:'FX rates are user-supplied management-reporting evidence. Native bank amounts are never rewritten.'
    });
  }catch(error){return fail(res,error,'Failed to load Finance FX rates.')}
};

exports.save=async(req,res)=>{
  try{
    const from=currency(req.body.from_currency),to=currency(req.body.to_currency);
    if(from===to)return res.status(400).json({message:'Choose two different currencies.',code:'FX_CURRENCIES_MUST_DIFFER'});
    const rate=rateValue(req.body.rate),date=effectiveDate(req.body.effective_date),note=sourceNote(req.body.source_note),uid=userId(req);
    const [[existing]]=await pool.query(
      'SELECT id,rate_uid FROM finance_fx_rates WHERE user_id=? AND from_currency=? AND to_currency=? AND effective_date=? LIMIT 1',
      [uid,from,to,date]
    );
    let rateUid=existing?.rate_uid;
    if(existing){
      await pool.query('UPDATE finance_fx_rates SET rate=?,source_note=?,active=1 WHERE id=? AND user_id=?',[rate,note,existing.id,uid]);
    }else{
      rateUid='FX-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
      await pool.query(
        'INSERT INTO finance_fx_rates (rate_uid,user_id,from_currency,to_currency,rate,effective_date,source_note) VALUES (?,?,?,?,?,?,?)',
        [rateUid,uid,from,to,rate,date,note]
      );
    }
    await logAudit(pool,audit(req,existing?'FINANCE_FX_RATE_UPDATED':'FINANCE_FX_RATE_CREATED',rateUid,{from_currency:from,to_currency:to,rate,effective_date:date,source_note:note}));
    return res.status(existing?200:201).json({message:'FX evidence saved. Native financial records were not changed.',rate_uid:rateUid});
  }catch(error){return fail(res,error,'Failed to save Finance FX rate.')}
};

exports.archive=async(req,res)=>{
  try{
    const uid=String(req.params.uid||'').trim();
    const [result]=await pool.query('UPDATE finance_fx_rates SET active=0 WHERE rate_uid=? AND user_id=? AND active=1',[uid,userId(req)]);
    if(!result.affectedRows)return res.status(404).json({message:'Active FX rate not found.',code:'FX_RATE_NOT_FOUND'});
    await logAudit(pool,audit(req,'FINANCE_FX_RATE_ARCHIVED',uid,null));
    return res.json({message:'FX rate archived. Native transactions and prior evidence remain unchanged.'});
  }catch(error){return fail(res,error,'Failed to archive Finance FX rate.')}
};
