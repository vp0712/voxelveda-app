'use strict';
const { FinanceError } = require('./financeDomain');

// Parse the document and its text layer, rather than trusting a file prefix or provider flag.
async function validateReportPdf(artifact,report) {
  if (!Buffer.isBuffer(artifact?.buffer) || artifact.buffer.length < 100 || !String(artifact.filename).toLowerCase().endsWith('.pdf'))
    throw new FinanceError('Generated PDF is invalid.',500,'PDF_ATTACHMENT_INVALID');
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(artifact.buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  let doc;
  try {
    doc = await task.promise;
    const texts = [];
    for (let pageNumber=1;pageNumber<=doc.numPages;pageNumber+=1) {
      const page = await doc.getPage(pageNumber);
      const layer = await page.getTextContent();
      texts.push(layer.items.map(item=>item.str||'').join(' '));
      page.cleanup();
    }
    const text = texts.join(' ').replace(/\s+/g,' ').trim();
    const compact=text.replace(/\s/g,'');
    if (!doc.numPages || text.length < 40 || !compact.includes(report.metadata.report_id))
      throw new FinanceError('PDF does not contain the expected report identity or readable content.',500,'PDF_CONTENT_INVALID');
    const count = String(report.metadata.source_transaction_count);
    const statement = report.metadata.report_type === 'ACCOUNT_STATEMENT';
    if(!/^\d+$/.test(count))throw new FinanceError('Saved report transaction count is invalid.',500,'PDF_CONTENT_INVALID');
    const countLabel = statement ? new RegExp('Transactions'+count+'(?!\\d)') : new RegExp('(?:^|\\D)'+count+'canonicaltransaction\\(s\\)');
    if (!countLabel.test(compact)) throw new FinanceError('PDF transaction count does not match the saved report.',500,'PDF_CONTENT_INVALID');
    // Every report PDF includes its transaction register. Validate expected record
    // text as well as identity, so a readable but unrelated PDF cannot be attached.
    const expectedDescriptions = new Map();
    const expectedAmounts = new Set();
    const formatted = value => new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));
    for(const record of report.transactions||[]){
      const expected=String(record.description||record.merchant_name||'Transaction').trim().slice(0,24).replace(/\s/g,'');
      if(expected) expectedDescriptions.set(expected,(expectedDescriptions.get(expected)||0)+1);
      for (const value of [record.debit,record.credit]) if (Number(value)>0) expectedAmounts.add(formatted(value));
      if(statement&&record.running_balance!=null) expectedAmounts.add(formatted(record.running_balance));
    }
    for (const [description,expectedCount] of expectedDescriptions) {
      let found=0,offset=0;
      while ((offset=compact.indexOf(description,offset))!==-1) { found+=1; offset+=description.length; }
      if(found<expectedCount)throw new FinanceError('PDF is missing expected transaction records. The saved HTML report remains available.',500,'PDF_CONTENT_INVALID');
    }
    for(const value of expectedAmounts){
      const exactAmount=new RegExp('(?:^|[^\\d.,-])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\d.,])');
      if(!exactAmount.test(text))throw new FinanceError('PDF is missing expected transaction amounts. The saved HTML report remains available.',500,'PDF_CONTENT_INVALID');
    }
    if(statement){
      const summary=report.account_statement;
      if(!summary)throw new FinanceError('Saved account statement totals are unavailable.',500,'PDF_CONTENT_INVALID');
      for(const [label,key] of [['Openingbalance','opening_running_balance'],['Closingbalance','closing_running_balance'],['Debits','total_debits'],['Credits','total_credits']]){
        if(!compact.includes(label+formatted(summary[key])))throw new FinanceError('PDF account statement totals do not match the saved report.',500,'PDF_CONTENT_INVALID');
      }
    }
    for(const row of report.summary_by_currency||[]){
      if(!text.includes(String(row.currency)))throw new FinanceError('PDF is missing an expected currency summary.',500,'PDF_CONTENT_INVALID');
      for(const value of [row.money_in,row.money_out,row.net_cash_flow]){
        const expected=formatted(value);
        // Account statements label total debits/credits and opening/closing balance.
        if(!statement&&!compact.includes(expected))throw new FinanceError('PDF totals do not match the saved report.',500,'PDF_CONTENT_INVALID');
      }
    }
    return {pages:doc.numPages,text_length:text.length,validation:'PARSED'};
  } catch(error) {
    if (error instanceof FinanceError) throw error;
    throw new FinanceError('PDF could not be parsed. The saved HTML report remains available.',500,'PDF_PARSE_FAILED');
  } finally { await task.destroy().catch(()=>{}); }
}
module.exports={validateReportPdf};
