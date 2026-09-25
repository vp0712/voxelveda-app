'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const PDFDocument=require('pdfkit');
const pool=require('../config/db');
const { ensureFinanceSchema }=require('../services/financeSchema');
const { FinanceError }=require('../services/financeDomain');
const { logAudit }=require('../services/auditService');
const { companyProfile }=require('../config/companyProfile');

function actor(req){return Number(req.user?.id||req.user?.user_id||0)||null}
function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
function day(v){return v?String(v).slice(0,10):null}
function money(v){return n(v).toFixed(2)}
function fail(res,error,message){
  if(error instanceof FinanceError)return res.status(error.statusCode||400).json({message:error.message,code:error.code});
  console.error(message,error);
  return res.status(500).json({message,code:'ACCOUNTANT_HANDOVER_FAILED'});
}
function audit(req,action,id,newValue){
  return {actorId:actor(req),action,module:'finance',recordType:'accountant_handover',recordId:String(id),newValue:newValue||null,
    requestId:req.requestId||null,sessionId:req.session?.id||null,ipAddress:req.ip||null,userAgent:req.get('user-agent')||null};
}
async function resolveYear(db,id){
  let row=null;
  if(Number(id)>0)[[row]]=await db.query('SELECT * FROM financial_years WHERE id=? LIMIT 1',[Number(id)]);
  if(!row)[[row]]=await db.query('SELECT * FROM financial_years WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1');
  if(!row)[[row]]=await db.query('SELECT * FROM financial_years ORDER BY start_date DESC LIMIT 1');
  if(!row)throw new FinanceError('No financial year is configured. Complete Finance Setup first.',409,'FINANCIAL_YEAR_NOT_CONFIGURED');
  return row;
}
async function companyIdentity(){
  const defaults=companyProfile();
  const keys=['company_legal_name','trading_name','company_address','company_email','abn','website','support_phone','report_footer'];
  const [rows]=await pool.query(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN (${keys.map(()=>'?').join(',')})`,keys).catch(()=>[[]]);
  const c=Object.fromEntries((rows||[]).map(r=>[r.setting_key,r.setting_value]));
  return {
    legalName:c.company_legal_name||defaults.legalName,tradingName:c.trading_name||defaults.name,
    address:c.company_address||defaults.address,email:c.company_email||defaults.email,abn:c.abn||defaults.abn,
    website:c.website||defaults.website,phone:c.support_phone||defaults.phone,
    footer:c.report_footer||'Confidential Financial Information'
  };
}
function coverageStatus(start,end,fyStart,fyEnd){
  const today=new Date().toISOString().slice(0,10);
  const target=fyEnd<today?fyEnd:today;
  if(!start||!end)return 'UNKNOWN';
  if(start<=fyStart&&end>=target)return 'COMPLETE';
  return 'PARTIAL';
}
async function buildPack(db,fy){
  const start=day(fy.start_date),end=day(fy.end_date);
  const [years,periods,accounts,bankSummary,ledgerQuality,billRows,invoiceRows,queries,issues,assets,exports,settings]=await Promise.all([
    db.query('SELECT id,label,start_date,end_date,status,readiness_score,blocking_issue_count,warning_issue_count FROM financial_years ORDER BY start_date DESC').then(([r])=>r),
    db.query(`SELECT ap.id,ap.period_key,ap.start_date,ap.end_date,ap.status,
        cr.status AS close_status,cr.certified_at,cr.certified_fingerprint,
        (SELECT COUNT(*) FROM finance_period_close_snapshots cs WHERE cs.accounting_period_id=ap.id) snapshot_count
      FROM accounting_periods ap
      LEFT JOIN finance_period_close_runs cr ON cr.accounting_period_id=ap.id
      WHERE ap.financial_year_id=? ORDER BY ap.start_date`,[fy.id]).then(([r])=>r),
    db.query(`SELECT ba.id,ba.nickname,ba.institution,ba.currency,ba.status,ba.ownership_scope,
        COUNT(bt.id) transaction_count,
        MIN(bt.transaction_date) earliest_transaction,MAX(bt.transaction_date) latest_transaction,
        SUM(CASE WHEN bt.reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) unreconciled_count,
        SUM(CASE WHEN COALESCE(TRIM(bt.category),'')='' THEN 1 ELSE 0 END) unclassified_count,
        SUM(CASE WHEN bt.id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM secure_documents sd
          WHERE sd.module='finance' AND sd.record_type='bank_transaction' AND CAST(sd.record_id AS UNSIGNED)=bt.id AND sd.deleted_at IS NULL
        ) THEN 1 ELSE 0 END) missing_receipt_count
      FROM bank_accounts ba
      LEFT JOIN bank_transactions bt ON bt.bank_account_id=ba.id
        AND bt.transaction_date BETWEEN ? AND ?
        AND bt.ownership_scope='BUSINESS'
        AND bt.archived_at IS NULL
        AND bt.reconciliation_status<>'IGNORED'
      WHERE ba.status='ACTIVE' AND ba.ownership_scope IN ('BUSINESS','MIXED')
      GROUP BY ba.id ORDER BY ba.currency,ba.nickname`,[start,end]).then(([r])=>r),
    db.query(`SELECT ba.currency,
        COUNT(*) transaction_count,
        SUM(CASE WHEN bt.credit>0 AND bt.is_internal_transfer=0 THEN bt.credit ELSE 0 END) money_in,
        SUM(CASE WHEN bt.debit>0 AND bt.is_internal_transfer=0 THEN bt.debit ELSE 0 END) money_out,
        SUM(CASE WHEN bt.is_internal_transfer=1 THEN 1 ELSE 0 END) internal_transfer_count
      FROM bank_transactions bt JOIN bank_accounts ba ON ba.id=bt.bank_account_id
      WHERE bt.transaction_date BETWEEN ? AND ? AND bt.ownership_scope='BUSINESS'
        AND bt.archived_at IS NULL AND bt.reconciliation_status<>'IGNORED'
      GROUP BY ba.currency ORDER BY ba.currency`,[start,end]).then(([r])=>r),
    db.query(`SELECT COUNT(*) total,
        SUM(CASE WHEN status IN ('DRAFT','INCOMPLETE','READY') THEN 1 ELSE 0 END) unposted,
        SUM(CASE WHEN status IN ('POSTED','RECONCILED') AND reconciliation_status='UNRECONCILED' THEN 1 ELSE 0 END) unreconciled,
        SUM(CASE WHEN status IN ('POSTED','RECONCILED') AND tax_code_id IS NULL THEN 1 ELSE 0 END) missing_tax_code,
        SUM(CASE WHEN status='VOID' THEN 1 ELSE 0 END) voided
      FROM finance_transactions WHERE financial_year_id=?`,[fy.id]).then(([r])=>r[0]||{}),
    db.query(`SELECT sb.id,sb.bill_uid,sb.supplier_invoice_no,sb.issue_date,sb.due_date,sb.total_amount,s.supplier_name,
        GREATEST(sb.total_amount-COALESCE((SELECT SUM(p.amount) FROM supplier_bill_payments p
          WHERE p.supplier_bill_id=sb.id AND p.voided_at IS NULL AND p.payment_date<=?),0),0) balance_at_year_end
      FROM supplier_bills sb JOIN suppliers s ON s.id=sb.supplier_id
      WHERE sb.issue_date<=? AND sb.status<>'VOID'
      HAVING balance_at_year_end>0.009
      ORDER BY COALESCE(sb.due_date,sb.issue_date),sb.id LIMIT 250`,[end,end]).then(([r])=>r),
    db.query(`SELECT i.id,i.invoice_no,i.customer_name,i.created_at,i.total,
        GREATEST(i.total-COALESCE((SELECT SUM(p.amount) FROM invoice_payments p
          WHERE p.invoice_id=i.id AND COALESCE(p.payment_date,DATE(p.created_at))<=?),0),0) balance_at_year_end
      FROM invoices i
      WHERE COALESCE(i.deleted,0)=0 AND DATE(i.created_at)<=? AND LOWER(COALESCE(i.status,'')) NOT IN ('rejected','void')
      HAVING balance_at_year_end>0.009
      ORDER BY i.created_at,i.id LIMIT 250`,[end,end]).then(([r])=>r).catch(e=>['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(e?.code)?[]:Promise.reject(e)),
    db.query(`SELECT id,query_uid,module,record_id,question,answer,status,raised_at,answered_at,resolved_at
      FROM accountant_queries WHERE financial_year_id=? OR financial_year_id IS NULL
      ORDER BY FIELD(status,'QUESTION','ANSWERED','RESOLVED'),raised_at,id LIMIT 250`,[fy.id]).then(([r])=>r),
    db.query(`SELECT id,severity,issue_type,module,record_type,record_id,title,message,status,created_at,resolved_at
      FROM finance_issues WHERE financial_year_id=?
      ORDER BY FIELD(severity,'BLOCKING_ERROR','WARNING','INFO'),created_at DESC LIMIT 250`,[fy.id]).then(([r])=>r),
    db.query(`SELECT id,asset_number,description,category,purchase_date,purchase_cost,accounting_status
      FROM assets WHERE (purchase_date IS NULL OR purchase_date<=?) AND COALESCE(accounting_status,'REVIEW_REQUIRED')<>'DISPOSED'
      ORDER BY accounting_status='REVIEW_REQUIRED' DESC,purchase_date DESC,id DESC LIMIT 250`,[end]).then(([r])=>r),
    db.query(`SELECT export_uid,version_no,export_status,checksum_sha256,generated_at,emailed_to,emailed_at
      FROM accountant_exports WHERE financial_year_id=? ORDER BY version_no DESC LIMIT 30`,[fy.id]).then(([r])=>r),
    db.query(`SELECT fs.default_currency,fs.gst_registered,fs.accountant_email,fs.entity_type,
        (SELECT setting_value FROM app_settings WHERE setting_key='gst_registration' LIMIT 1) AS gst_registration
      FROM finance_settings fs WHERE fs.id=1`).then(([r])=>r[0]||{})
  ]);
  const accountsOut=accounts.map(a=>({
    ...a,transaction_count:n(a.transaction_count),unreconciled_count:n(a.unreconciled_count),
    unclassified_count:n(a.unclassified_count),missing_receipt_count:n(a.missing_receipt_count),
    earliest_transaction:day(a.earliest_transaction),latest_transaction:day(a.latest_transaction),
    coverage_status:coverageStatus(day(a.earliest_transaction),day(a.latest_transaction),start,end)
  }));
  const ap=billRows.reduce((x,r)=>x+n(r.balance_at_year_end),0);
  const ar=invoiceRows.reduce((x,r)=>x+n(r.balance_at_year_end),0);
  const openQueries=queries.filter(q=>q.status!=='RESOLVED');
  const openIssues=issues.filter(x=>!['RESOLVED','IGNORED'].includes(String(x.status).toUpperCase()));
  const close={
    period_count:periods.length,
    locked:periods.filter(p=>p.status==='LOCKED').length,
    certified:periods.filter(p=>p.close_status==='CERTIFIED').length,
    missing_certification:periods.filter(p=>p.close_status!=='CERTIFIED').length,
    snapshots:periods.reduce((x,p)=>x+n(p.snapshot_count),0)
  };
  const gaps={
    bank_unreconciled:accountsOut.reduce((x,a)=>x+a.unreconciled_count,0),
    bank_unclassified:accountsOut.reduce((x,a)=>x+a.unclassified_count,0),
    missing_receipts:accountsOut.reduce((x,a)=>x+a.missing_receipt_count,0),
    incomplete_account_coverage:accountsOut.filter(a=>a.coverage_status!=='COMPLETE').length,
    ledger_unposted:n(ledgerQuality.unposted),
    ledger_unreconciled:n(ledgerQuality.unreconciled),
    ledger_missing_tax_code:n(ledgerQuality.missing_tax_code),
    open_accountant_queries:openQueries.length,
    open_finance_issues:openIssues.length,
    assets_review_required:assets.filter(a=>a.accounting_status==='REVIEW_REQUIRED').length,
    periods_not_certified:close.missing_certification
  };
  const blockerCount=n(fy.blocking_issue_count)+gaps.ledger_unposted+gaps.ledger_unreconciled+gaps.bank_unreconciled+gaps.periods_not_certified;
  const warningCount=n(fy.warning_issue_count)+gaps.bank_unclassified+gaps.missing_receipts+gaps.ledger_missing_tax_code+
    gaps.open_accountant_queries+gaps.assets_review_required+gaps.incomplete_account_coverage;
  return {
    rule:'Company accountant handover is BUSINESS-only. Personal Money, personal cash wallets, personal debts and Personal bank transaction detail are excluded.',
    year:{...fy,start_date:start,end_date:end,readiness_score:n(fy.readiness_score),blocking_issue_count:n(fy.blocking_issue_count),warning_issue_count:n(fy.warning_issue_count)},
    financial_years:years.map(y=>({...y,start_date:day(y.start_date),end_date:day(y.end_date)})),
    settings:{
      default_currency:String(settings.default_currency||'AUD').toUpperCase(),gst_registered:settings.gst_registered,
      gst_registration:settings.gst_registration||'UNKNOWN',accountant_email:settings.accountant_email||null,entity_type:settings.entity_type||null
    },
    handover_status:blockerCount?'NOT_READY':warningCount?'REVIEW':'READY',
    blocker_count:blockerCount,warning_count:warningCount,gaps,close,
    accounting_periods:periods.map(p=>({...p,start_date:day(p.start_date),end_date:day(p.end_date)})),
    bank_accounts:accountsOut,
    bank_summary_by_currency:bankSummary.map(r=>({...r,transaction_count:n(r.transaction_count),money_in:n(r.money_in),money_out:n(r.money_out),internal_transfer_count:n(r.internal_transfer_count)})),
    ledger_quality:Object.fromEntries(Object.entries(ledgerQuality).map(([k,v])=>[k,n(v)])),
    payables:{currency:String(settings.default_currency||'AUD').toUpperCase(),balance:Math.round(ap*100)/100,count:billRows.length,items:billRows},
    receivables:{currency:String(settings.default_currency||'AUD').toUpperCase(),balance:Math.round(ar*100)/100,count:invoiceRows.length,items:invoiceRows},
    accountant_queries:queries,finance_issues:issues,assets,exports,
    generated_at:new Date().toISOString()
  };
}
function manifest(pack){
  return {
    financial_year:{id:pack.year.id,label:pack.year.label,start_date:pack.year.start_date,end_date:pack.year.end_date,status:pack.year.status},
    handover_status:pack.handover_status,blocker_count:pack.blocker_count,warning_count:pack.warning_count,
    gaps:pack.gaps,close:pack.close,
    bank_accounts:pack.bank_accounts.map(a=>({
      id:a.id,nickname:a.nickname,currency:a.currency,coverage_status:a.coverage_status,transaction_count:a.transaction_count,
      unreconciled_count:a.unreconciled_count,unclassified_count:a.unclassified_count,missing_receipt_count:a.missing_receipt_count,
      earliest_transaction:a.earliest_transaction,latest_transaction:a.latest_transaction
    })),
    bank_summary_by_currency:pack.bank_summary_by_currency,ledger_quality:pack.ledger_quality,
    payables:{currency:pack.payables.currency,balance:pack.payables.balance,count:pack.payables.count},
    receivables:{currency:pack.receivables.currency,balance:pack.receivables.balance,count:pack.receivables.count},
    open_accountant_queries:pack.accountant_queries.filter(q=>q.status!=='RESOLVED').length,
    open_finance_issues:pack.finance_issues.filter(x=>!['RESOLVED','IGNORED'].includes(String(x.status).toUpperCase())).length,
    assets_review_required:pack.assets.filter(a=>a.accounting_status==='REVIEW_REQUIRED').length,
    generated_at:pack.generated_at
  };
}
exports.getCenter=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const fy=await resolveYear(pool,req.query.financial_year_id);
    return res.json(await buildPack(pool,fy));
  }catch(error){return fail(res,error,'Failed to load Accountant Handover & Audit Pack.')}
};
exports.captureSnapshot=async(req,res)=>{
  const db=await pool.getConnection();
  try{
    await ensureFinanceSchema();
    await db.beginTransaction();
    const selectedYear=await resolveYear(db,req.params.financialYearId);
    const [[fy]]=await db.query('SELECT * FROM financial_years WHERE id=? LIMIT 1 FOR UPDATE',[selectedYear.id]);
    const pack=await buildPack(db,fy);
    const payload=manifest(pack),json=JSON.stringify(payload),checksum=crypto.createHash('sha256').update(json).digest('hex');
    const [[last]]=await db.query('SELECT version_no FROM accountant_exports WHERE financial_year_id=? ORDER BY version_no DESC LIMIT 1 FOR UPDATE',[fy.id]);
    const version=n(last?.version_no)+1;
    const exportUid=`HANDOVER-${fy.label}-V${version}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await db.query(`INSERT INTO accountant_exports
      (export_uid,financial_year_id,version_no,export_status,manifest_json,checksum_sha256,generated_by)
      VALUES (?,?,?,'SNAPSHOT',?,?,?)`,[exportUid,fy.id,version,json,checksum,actor(req)]);
    await logAudit(db,audit(req,'ACCOUNTANT_HANDOVER_SNAPSHOT_CAPTURED',exportUid,{
      financial_year_id:fy.id,version_no:version,checksum_sha256:checksum,
      handover_status:pack.handover_status,blocker_count:pack.blocker_count,warning_count:pack.warning_count
    }));
    await db.commit();
    return res.status(201).json({
      message:'Versioned accountant handover evidence snapshot captured. No financial record was changed.',
      export_uid:exportUid,version_no:version,checksum_sha256:checksum,handover_status:pack.handover_status
    });
  }catch(error){
    await db.rollback().catch(()=>{});
    return fail(res,error,'Failed to capture accountant handover snapshot.');
  }finally{db.release()}
};
function addSection(doc,title){
  if(doc.y>700)doc.addPage();
  doc.moveDown(.7).fontSize(13).fillColor('#111827').text(title);
  doc.moveDown(.25);
}
function row(doc,label,value,note=''){
  if(doc.y>720)doc.addPage();
  doc.fontSize(8.5).fillColor('#111827').text(label,{width:330,continued:true});
  doc.text(String(value??'—'),{width:160,align:'right'});
  if(note)doc.fontSize(7).fillColor('#6b7280').text(note);
}
exports.pdf=async(req,res)=>{
  try{
    await ensureFinanceSchema();
    const fy=await resolveYear(pool,req.params.financialYearId);
    const pack=await buildPack(pool,fy),p=await companyIdentity();
    const latest=pack.exports[0]||null;
    const reportId=`HANDOVER-${fy.label}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    const generated=new Date();
    const doc=new PDFDocument({
      size:'A4',margins:{top:112,left:42,right:42,bottom:66},bufferPages:true,
      info:{Title:`${p.legalName} - ${fy.label} Accountant Handover`,Author:p.legalName}
    });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="Voxel-Veda-${fy.label}-Accountant-Handover.pdf"`);
    doc.pipe(res);

    doc.fontSize(21).fillColor('#111827').text('Accountant Handover & Audit Pack');
    doc.moveDown(.3).fontSize(11).fillColor('#374151').text(`${fy.label} · ${pack.year.start_date} to ${pack.year.end_date}`);
    row(doc,'Handover status',pack.handover_status,`${pack.blocker_count} blocker(s) · ${pack.warning_count} warning(s)`);
    row(doc,'Financial year status',fy.status,`Recorded readiness ${money(fy.readiness_score)}%`);
    row(doc,'Evidence snapshot',latest?`${latest.export_uid} · v${latest.version_no}`:'No versioned handover snapshot yet',
      latest?.checksum_sha256?`SHA-256 ${latest.checksum_sha256}`:'Capture a snapshot before external handover.');
    doc.moveDown(.4).fontSize(8).fillColor('#6b7280').text(pack.rule);

    addSection(doc,'Control gaps');
    for(const [k,v] of Object.entries(pack.gaps))row(doc,String(k).replaceAll('_',' '),v);

    addSection(doc,'Accounting period close');
    row(doc,'Periods',pack.close.period_count);
    row(doc,'Certified',pack.close.certified);
    row(doc,'Locked',pack.close.locked);
    row(doc,'Not certified',pack.close.missing_certification);
    row(doc,'Immutable close snapshots',pack.close.snapshots);

    addSection(doc,'Business bank evidence');
    for(const a of pack.bank_accounts){
      row(doc,`${a.nickname} · ${a.currency}`,a.coverage_status,
        `${a.transaction_count} business transaction(s) · ${a.earliest_transaction||'—'} to ${a.latest_transaction||'—'} · ${a.unreconciled_count} unreconciled · ${a.unclassified_count} unclassified · ${a.missing_receipt_count} missing receipt(s)`);
    }

    addSection(doc,'Business cash-flow summary');
    for(const x of pack.bank_summary_by_currency){
      row(doc,x.currency,`In ${money(x.money_in)} · Out ${money(x.money_out)}`,
        `${x.transaction_count} transaction(s) · ${x.internal_transfer_count} internal transfer(s)`);
    }

    addSection(doc,'Year-end balances');
    row(doc,'Supplier payables',`${pack.payables.currency} ${money(pack.payables.balance)}`,`${pack.payables.count} open item(s) at year end`);
    row(doc,'Customer receivables',`${pack.receivables.currency} ${money(pack.receivables.balance)}`,`${pack.receivables.count} open item(s) at year end`);
    row(doc,'Unposted finance ledger items',pack.ledger_quality.unposted);
    row(doc,'Unreconciled posted finance items',pack.ledger_quality.unreconciled);
    row(doc,'Posted items missing tax code',pack.ledger_quality.missing_tax_code);

    addSection(doc,'Accountant questions & review');
    const openQueries=pack.accountant_queries.filter(q=>q.status!=='RESOLVED');
    for(const q of openQueries.slice(0,80))row(doc,q.question,q.status,q.answer||'No answer recorded.');
    if(!openQueries.length)row(doc,'Open accountant questions',0);
    const reviewAssets=pack.assets.filter(a=>a.accounting_status==='REVIEW_REQUIRED');
    row(doc,'Assets requiring accounting review',reviewAssets.length);
    const openIssues=pack.finance_issues.filter(x=>!['RESOLVED','IGNORED'].includes(String(x.status).toUpperCase()));
    for(const issue of openIssues.slice(0,60))row(doc,issue.title||issue.message||'Finance issue',issue.severity,issue.status);

    addSection(doc,'Recommended evidence exports');
    row(doc,'Trial Balance','Finance → Reports → Trial Balance CSV');
    row(doc,'Company transaction register','Finance → Reports → Company / Transaction Register');
    row(doc,'GST review','Finance → Reports → GST Summary');
    row(doc,'Data quality','Finance → Reports → Data Quality');
    row(doc,'Close evidence','Finance → Close & Assurance → immutable snapshots');
    doc.fontSize(7.2).fillColor('#6b7280').text(
      'This pack is a controlled internal handover summary. It does not replace accountant review, tax advice, statutory lodgement or source documents.'
    );

    const logoPath=path.join(__dirname,'..','public','Frame 1.png');
    const pages=doc.bufferedPageRange();
    for(let i=0;i<pages.count;i++){
      doc.switchToPage(i);
      if(fs.existsSync(logoPath)){try{doc.image(logoPath,42,28,{fit:[54,42]})}catch{}}
      doc.fontSize(10.5).fillColor('#111827').text(p.legalName,106,28,{width:280});
      const identity=[p.abn?`ABN ${p.abn}`:null,p.website||null,p.email||null].filter(Boolean).join(' · ');
      doc.fontSize(7.2).fillColor('#6b7280').text(identity,106,44,{width:440});
      doc.fontSize(7.2).text(`Accountant Handover · ${fy.label} · Generated ${generated.toLocaleString('en-AU')} · ${reportId}`,42,78,{width:510});
      doc.moveTo(42,94).lineTo(553,94).strokeColor('#d1d5db').lineWidth(.6).stroke();
      doc.moveTo(42,774).lineTo(553,774).strokeColor('#d1d5db').lineWidth(.6).stroke();
      doc.fontSize(7.2).fillColor('#6b7280').text(`${p.footer} · Page ${i+1} of ${pages.count}`,42,782,{width:510,align:'center'});
    }
    await logAudit(pool,audit(req,'ACCOUNTANT_HANDOVER_PDF_EXPORTED',reportId,{
      financial_year_id:fy.id,financial_year:fy.label,pages:pages.count,
      latest_snapshot_uid:latest?.export_uid||null,handover_status:pack.handover_status
    }));
    doc.end();
  }catch(error){
    if(!res.headersSent)return fail(res,error,'Failed to generate Accountant Handover PDF.');
    res.end();
  }
};
module.exports._test={coverageStatus,manifest};
