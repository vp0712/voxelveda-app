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
    if (!text.includes(count)) throw new FinanceError('PDF transaction count is unreadable.',500,'PDF_CONTENT_INVALID');
    // Every report PDF includes its transaction register. Validate expected record
    // text as well as identity, so a readable but unrelated PDF cannot be attached.
    for(const record of report.transactions||[]){
      const expected=String(record.description||record.merchant_name||'Transaction').trim().slice(0,24).replace(/\s/g,'');
      if(expected&&!compact.includes(expected))throw new FinanceError('PDF is missing expected transaction text. The saved HTML report remains available.',500,'PDF_CONTENT_INVALID');
    }
    for(const row of report.summary_by_currency||[]){
      if(!text.includes(String(row.currency)))throw new FinanceError('PDF is missing an expected currency summary.',500,'PDF_CONTENT_INVALID');
      for(const value of [row.money_in,row.money_out,row.net_cash_flow]){
        const expected=new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));
        // Account statements label total debits/credits and opening/closing balance.
        if(report.metadata.report_type!=='ACCOUNT_STATEMENT'&&!compact.includes(expected))throw new FinanceError('PDF totals do not match the saved report.',500,'PDF_CONTENT_INVALID');
      }
    }
    return {pages:doc.numPages,text_length:text.length,validation:'PARSED'};
  } catch(error) {
    if (error instanceof FinanceError) throw error;
    throw new FinanceError('PDF could not be parsed. The saved HTML report remains available.',500,'PDF_PARSE_FAILED');
  } finally { await task.destroy().catch(()=>{}); }
}
module.exports={validateReportPdf};
