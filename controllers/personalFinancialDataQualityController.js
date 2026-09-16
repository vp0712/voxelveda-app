const pool = require('../config/db');
const { ensureSecurityGovernanceSchema } = require('../services/securityGovernanceSchema');

function userId(req) {
  const value = req.user?.id ?? req.user?.user_id;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('User identity unavailable.'), { statusCode: 401 });
  return String(value);
}
function round(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100;}
function err(res,e){const s=Number(e?.statusCode||500);if(s>=500)console.error('Failed to load Personal Financial Data Quality Center.',e);return res.status(s).json({message:s>=500?'Failed to load Personal Financial Data Quality Center.':e.message});}
function monthsBetween(start,end){if(!start||!end)return[];const out=[];let y=Number(String(start).slice(0,4)),m=Number(String(start).slice(5,7));const ey=Number(String(end).slice(0,4)),em=Number(String(end).slice(5,7));while(y<ey||(y===ey&&m<=em)){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m===13){m=1;y++;}if(out.length>240)break;}return out;}
function parseJson(v){if(v===null||v===undefined||v==='')return null;if(typeof v==='object')return v;try{return JSON.parse(v);}catch{return v;}}
function actionLabel(v){return String(v||'').toLowerCase().split('_').filter(Boolean).map(x=>x[0].toUpperCase()+x.slice(1)).join(' ');}

exports.getCenter = async (req,res)=>{
  try{
    await ensureSecurityGovernanceSchema();
    const uid=userId(req);
    const [accounts,txSummary,duplicateGroups,monthly,wallets,cashEntries,imports,auditRows]=await Promise.all([
      pool.query(`SELECT id,nickname,institution,currency,connection_type,connection_status,current_ledger_balance,available_balance,history_start_date,history_end_date,last_synced_at
        FROM bank_accounts WHERE created_by=? AND ownership_scope='PERSONAL' AND status='ACTIVE' ORDER BY nickname`,[uid]).then(([r])=>r),
      pool.query(`SELECT COUNT(*) total,
          SUM(CASE WHEN bt.classification_status='UNCLASSIFIED' OR bt.category IS NULL OR bt.category='' THEN 1 ELSE 0 END) unclassified,
          SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) unreconciled,
          SUM(CASE WHEN bt.is_internal_transfer=0 AND (LOWER(COALESCE(bt.description,'')) REGEXP 'transfer|osko|payid|internal transfer' OR LOWER(COALESCE(bt.merchant_name,'')) REGEXP 'transfer|osko|payid') THEN 1 ELSE 0 END) possible_transfer_candidates,
          MIN(bt.transaction_date) first_transaction_date,MAX(bt.transaction_date) last_transaction_date
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'`,[uid]).then(([r])=>r[0]||{}),
      pool.query(`SELECT bt.bank_account_id,ba.nickname,bt.transaction_date,bt.currency,bt.debit,bt.credit,
          LOWER(TRIM(COALESCE(bt.description,''))) description_key,COUNT(*) duplicate_count
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
        GROUP BY bt.bank_account_id,ba.nickname,bt.transaction_date,bt.currency,bt.debit,bt.credit,LOWER(TRIM(COALESCE(bt.description,'')))
        HAVING COUNT(*)>1 ORDER BY duplicate_count DESC,bt.transaction_date DESC LIMIT 100`,[uid]).then(([r])=>r),
      pool.query(`SELECT bt.bank_account_id,DATE_FORMAT(bt.transaction_date,'%Y-%m') month,COUNT(*) transaction_count
        FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
        GROUP BY bt.bank_account_id,DATE_FORMAT(bt.transaction_date,'%Y-%m') ORDER BY bt.bank_account_id,month`,[uid]).then(([r])=>r),
      pool.query(`SELECT id,name,currency,balance,updated_at FROM personal_money_wallets WHERE user_id=? AND active=1 ORDER BY name`,[uid]).then(([r])=>r),
      pool.query(`SELECT id,wallet_id,entry_type,amount,currency,wallet_amount,category,counterparty,note,occurred_at
        FROM personal_money_entries WHERE user_id=? AND entry_type IN ('CASH_IN','CASH_OUT','ADJUSTMENT')
        ORDER BY occurred_at DESC LIMIT 300`,[uid]).then(([r])=>r),
      pool.query(`SELECT sif.import_uid,sif.bank_account_id,ba.nickname,sif.source_format,sif.statement_start_date,sif.statement_end_date,sif.imported_rows,sif.duplicate_rows,sif.rejected_rows,sif.reviewed_at
        FROM statement_import_files sif JOIN bank_accounts ba ON ba.id=sif.bank_account_id
        WHERE ba.created_by=? AND ba.ownership_scope='PERSONAL' ORDER BY sif.reviewed_at DESC LIMIT 50`,[uid]).then(([r])=>r),
      pool.query(`SELECT al.id,al.actor_id,al.action,al.module,al.record_type,al.record_id,al.old_value,al.new_value,al.request_id,al.session_id,al.result,al.metadata_json,al.previous_integrity_hash,al.integrity_hash,al.created_at,
          bt.transaction_date,bt.description,bt.merchant_name,bt.currency,bt.debit,bt.credit,bt.category,bt.classification_status,bt.is_internal_transfer,bt.reconciliation_status,ba.nickname account_name
        FROM audit_logs al
        JOIN bank_transactions bt ON al.record_type='bank_transaction' AND CAST(al.record_id AS UNSIGNED)=bt.id
        JOIN bank_accounts ba ON ba.id=bt.bank_account_id
        WHERE al.actor_id=? AND ba.created_by=? AND ba.ownership_scope='PERSONAL' AND bt.ownership_scope='PERSONAL'
        ORDER BY al.created_at DESC,al.id DESC LIMIT 300`,[uid,uid]).then(([r])=>r)
    ]);

    const monthCounts=new Map();for(const r of monthly){monthCounts.set(`${r.bank_account_id}|${r.month}`,Number(r.transaction_count||0));}
    const possibleMissingPeriods=[];
    for(const a of accounts){const start=a.history_start_date||txSummary.first_transaction_date,end=a.history_end_date||txSummary.last_transaction_date;if(!start||!end)continue;for(const m of monthsBetween(start,end)){if(!monthCounts.get(`${a.id}|${m}`))possibleMissingPeriods.push({account_id:a.id,account_name:a.nickname,currency:a.currency,month:m,reason:'No recorded transaction in a month inside the imported history range. This can be a genuine zero-activity month, so review before treating it as missing data.'});}}
    const now=Date.now();
    const staleAccounts=accounts.filter(a=>{const last=a.last_synced_at?new Date(a.last_synced_at).getTime():0;const hist=a.history_end_date?new Date(`${String(a.history_end_date).slice(0,10)}T00:00:00Z`).getTime():0;return (String(a.connection_type||'').toUpperCase()!=='MANUAL'&&(!last||now-last>14*86400000))||(hist&&now-hist>45*86400000);}).map(a=>({id:a.id,name:a.nickname,currency:a.currency,connection_type:a.connection_type,last_synced_at:a.last_synced_at,history_end_date:a.history_end_date}));
    const unclassifiedCash=cashEntries.filter(e=>!e.category||(!e.counterparty&&!e.note)).map(e=>({id:e.id,wallet_id:e.wallet_id,entry_type:e.entry_type,amount:Number(e.amount||0),currency:e.currency,category:e.category,counterparty:e.counterparty,occurred_at:e.occurred_at}));
    const balanceSimilarity=[];
    for(const w of wallets){for(const a of accounts){if(String(w.currency)!==String(a.currency))continue;const bank=Number(a.available_balance??a.current_ledger_balance??0),wallet=Number(w.balance||0);if(Math.abs(bank-wallet)<=0.01&&Math.abs(bank)>0.01)balanceSimilarity.push({wallet_id:w.id,wallet_name:w.name,account_id:a.id,account_name:a.nickname,currency:w.currency,amount:round(bank),reason:'Wallet and bank balance are identical. This is only a double-counting risk signal, not proof they represent the same money.'});}}
    const importIssues=imports.filter(i=>Number(i.duplicate_rows||0)>0||Number(i.rejected_rows||0)>0).map(i=>({...i,imported_rows:Number(i.imported_rows||0),duplicate_rows:Number(i.duplicate_rows||0),rejected_rows:Number(i.rejected_rows||0)}));
    const auditTrail=auditRows.map(r=>({id:Number(r.id),created_at:r.created_at,actor:{id:Number(r.actor_id),label:'You'},action:r.action,action_label:actionLabel(r.action),module:r.module,record_type:r.record_type,record_id:String(r.record_id||''),result:r.result||'SUCCESS',old_value:parseJson(r.old_value),new_value:parseJson(r.new_value),metadata:parseJson(r.metadata_json),request_id:r.request_id||null,session_id:r.session_id||null,integrity:{present:Boolean(r.integrity_hash),hash_prefix:r.integrity_hash?String(r.integrity_hash).slice(0,12):null,previous_hash_recorded:Boolean(r.previous_integrity_hash)},step_up_context:String(r.action||'').toUpperCase()==='RECONCILIATION_CLASSIFIED'?'Step-up authentication is required by the route for this action.':'Step-up status is not universally recorded on this audit row.',transaction:{date:r.transaction_date,account_name:r.account_name,description:r.description||r.merchant_name||'',currency:r.currency,amount:Number(r.credit||0)-Number(r.debit||0),current_category:r.category,classification_status:r.classification_status,is_internal_transfer:Number(r.is_internal_transfer||0)===1,reconciliation_status:r.reconciliation_status}}));
    const auditActionCounts={};let auditLast30=0,auditIntegrity=0;const auditSessions=new Set();for(const a of auditTrail){auditActionCounts[a.action]=(auditActionCounts[a.action]||0)+1;if(new Date(a.created_at).getTime()>=now-30*86400000)auditLast30++;if(a.integrity.present)auditIntegrity++;if(a.session_id)auditSessions.add(a.session_id);}
    const auditSummary={events:auditTrail.length,last_30_days:auditLast30,integrity_hash_present:auditIntegrity,sessions_represented:auditSessions.size,action_counts:auditActionCounts};
    const summary={personal_accounts:accounts.length,total_bank_transactions:Number(txSummary.total||0),unclassified_bank_transactions:Number(txSummary.unclassified||0),unreconciled_bank_transactions:Number(txSummary.unreconciled||0),possible_duplicate_groups:duplicateGroups.length,possible_missing_periods:possibleMissingPeriods.length,stale_accounts:staleAccounts.length,possible_transfer_candidates:Number(txSummary.possible_transfer_candidates||0),unclassified_cash_movements:unclassifiedCash.length,wallet_bank_double_count_risks:balanceSimilarity.length,imports_with_issues:importIssues.length};
    const findings=[];
    const add=(severity,type,title,count,why,next_step)=>{if(count>0)findings.push({severity,type,title,count,why,next_step});};
    add('HIGH','DUPLICATE','Possible duplicate bank transactions',summary.possible_duplicate_groups,'Same account/date/currency/debit/credit/normalised description appears more than once.','Review the duplicate groups before deleting or ignoring anything; legitimate repeated purchases can look identical.');
    add('HIGH','HISTORY','Possible missing statement periods',summary.possible_missing_periods,'A month inside an account’s recorded history range has no transactions.','Check the original statement or bank connection coverage for that month before importing anything again.');
    add('WATCH','CLASSIFICATION','Unclassified bank transactions',summary.unclassified_bank_transactions,'Unclassified spending weakens budgets, tax review and category analytics.','Review categories in the transaction/review tools; do not auto-classify without checking.');
    add('WATCH','RECONCILIATION','Unreconciled bank transactions',summary.unreconciled_bank_transactions,'Unreconciled items reduce confidence in balances and reports.','Open reconciliation and review source evidence before confirming any match.');
    add('WATCH','STALE','Stale account data',summary.stale_accounts,'Connected/sourced account information may be old.','Refresh/import the missing period after checking the source account and avoiding duplicate statement imports.');
    add('WATCH','TRANSFER','Possible unmatched transfer candidates',summary.possible_transfer_candidates,'Transfer-like descriptions are not marked as confirmed internal transfers.','Review both sides of the movement; a keyword match alone does not prove an internal transfer.');
    add('WATCH','CASH','Incomplete cash movement details',summary.unclassified_cash_movements,'Cash entries are missing a category or both counterparty and note.','Add enough context for later review; do not invent a category.');
    add('WATCH','DOUBLE_COUNT','Possible wallet/bank double-counting risks',summary.wallet_bank_double_count_risks,'A Personal Money wallet balance exactly matches a personal bank balance in the same currency.','Confirm whether the wallet is physical cash/another pool or simply mirrors the bank account before relying on combined liquidity.');
    add('WATCH','IMPORT','Statement imports with duplicates/rejections',summary.imports_with_issues,'Recent personal statement imports reported duplicate or rejected rows.','Review import results and source statement coverage before re-importing.');
    return res.json({privacy:'Owner-only PERSONAL data quality audit. Voxel Veda company accounting is excluded.',currency_rule:'Currencies remain separate. No FX conversion or cross-currency quality total is calculated.',read_only:true,limitations:['Duplicate detection is a similarity check and may include legitimate repeated transactions.','A zero-transaction month may be genuine and is labelled possible missing coverage, not confirmed missing data.','Transfer candidates are keyword-based review signals and are not automatically reclassified.','Equal wallet/bank balances are only a double-counting risk signal, never an automatic merge or correction.'],summary,accounts,findings,possible_duplicate_groups:duplicateGroups.map(x=>({...x,debit:Number(x.debit||0),credit:Number(x.credit||0),duplicate_count:Number(x.duplicate_count||0)})),possible_missing_periods:possibleMissingPeriods.slice(0,120),stale_accounts:staleAccounts,possible_transfer_candidates:Number(txSummary.possible_transfer_candidates||0),unclassified_cash_movements:unclassifiedCash.slice(0,100),wallet_bank_double_count_risks:balanceSimilarity,imports_with_issues:importIssues,audit_trail:{privacy:'Owner-only PERSONAL bank-transaction change history. Voxel Veda company finance events are excluded at query level.',read_only:true,integrity_note:'This filtered view shows whether each returned audit row has an integrity hash. Because the global audit chain also contains events outside this PERSONAL subset, this page does not claim to independently re-verify full-chain continuity.',step_up_note:'Only actions known to use a step-up-protected route are labelled as requiring step-up. Other rows are shown as not universally recorded rather than inferred.',summary:auditSummary,events:auditTrail}});
  }catch(e){return err(res,e);}
};
