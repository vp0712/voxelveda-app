(() => {
  'use strict';
  if (location.pathname !== '/finance-intelligence' || window.__vvPdfV3Installed) return;
  window.__vvPdfV3Installed = true;

  const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
  const amountRx=/[-+]?\(?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?/gi;
  const moneyNumber=(value)=>{const raw=clean(value).replace(/\b(?:CR|DR)\b/gi,'').replace(/[$,\s]/g,'').replace(/^\((.*)\)$/,'-$1');const n=Number(raw);return Number.isFinite(n)?n:null;};
  const isBalanceMarker=(value)=>{const t=clean(value).toLowerCase();return /^(opening|closing|current|available) balance\b/.test(t)||/\bbalance (?:brought|carried) forward\b/.test(t)||/\bbalance (?:b\/f|c\/f)\b/.test(t);};

  function iso(y,m,d){const value=`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const dt=new Date(`${value}T00:00:00Z`);return !Number.isNaN(dt.valueOf())&&dt.toISOString().slice(0,10)===value?value:null;}
  function fullDate(text){let m=clean(text).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);if(m){let y=Number(m[3]);if(y<100)y+=y>=70?1900:2000;return iso(y,Number(m[2]),Number(m[1]));}m=clean(text).match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/);if(m){let y=Number(m[3]);if(y<100)y+=y>=70?1900:2000;return iso(y,MONTHS[m[2].slice(0,3).toLowerCase()],Number(m[1]));}return null;}
  function partialDate(text){const m=clean(text).match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\b/);return m&&MONTHS[m[2].slice(0,3).toLowerCase()]?{day:Number(m[1]),month:MONTHS[m[2].slice(0,3).toLowerCase()]}:null;}
  function allFullDates(text){return [...String(text||'').matchAll(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b/g)].map(m=>fullDate(m[0])).filter(Boolean);}
  function statementPeriod(text){
    const lines=String(text||'').split(/\n+/).map(clean).filter(Boolean);
    for(const line of lines){if(!/(statement period|from|period covered|date range)/i.test(line))continue;const dates=allFullDates(line);if(dates.length>=2)return{start:dates[0],end:dates[1]};}
    const dates=[...new Set(allFullDates(text))].sort();
    if(dates.length>=2){const first=dates[0],last=dates[dates.length-1];const days=(new Date(`${last}T00:00:00Z`)-new Date(`${first}T00:00:00Z`))/86400000;if(days>=0&&days<=400)return{start:first,end:last};}
    return{start:null,end:null};
  }
  function inferYear(partial,period,previousDate=null){
    if(!partial)return null;
    if(period?.start&&period?.end){const startYear=Number(period.start.slice(0,4)),endYear=Number(period.end.slice(0,4));for(let y=startYear;y<=endYear;y++){const candidate=iso(y,partial.month,partial.day);if(candidate&&candidate>=period.start&&candidate<=period.end)return candidate;}}
    if(previousDate){const base=Number(String(previousDate).slice(0,4));const candidates=[base-1,base,base+1].map(y=>iso(y,partial.month,partial.day)).filter(Boolean).sort((a,b)=>Math.abs(new Date(a)-new Date(previousDate))-Math.abs(new Date(b)-new Date(previousDate)));if(candidates[0])return candidates[0];}
    return null;
  }

  async function extractGeometry(file){
    if(!window.pdfjsLib)throw new Error('PDF engine is unavailable. Refresh and try again.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;const pages=[];
    for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p);const content=await page.getTextContent();const tokens=(content.items||[]).map(i=>({page:p,text:clean(i.str),x:Number(i.transform?.[4]||0),y:Number(i.transform?.[5]||0),w:Number(i.width||0),h:Number(i.height||0)})).filter(t=>t.text);const lines=[];for(const token of tokens.sort((a,b)=>b.y-a.y||a.x-b.x)){let line=lines.find(l=>Math.abs(l.y-token.y)<=3);if(!line){line={page:p,y:token.y,tokens:[]};lines.push(line);}line.tokens.push(token);}lines.forEach(l=>{l.tokens.sort((a,b)=>a.x-b.x);l.text=clean(l.tokens.map(t=>t.text).join(' '));});pages.push({page:p,tokens,lines:lines.sort((a,b)=>b.y-a.y)});}
    return pages;
  }

  function findColumns(pages){
    const aliases={date:/^(date|transaction date|value date)$/i,description:/^(description|details|transaction details|narrative|merchant)$/i,debit:/^(debit|withdrawal|withdrawals|money out|paid out)$/i,credit:/^(credit|deposit|deposits|money in|paid in)$/i,balance:/^(balance|running balance|account balance)$/i,amount:/^(amount|transaction amount)$/i};
    let best=null;
    for(const page of pages){for(const line of page.lines){const found={};for(const token of line.tokens){for(const [key,rx] of Object.entries(aliases)){if(rx.test(token.text))found[key]=token.x;}}const score=Object.keys(found).length;if(score>=2&&(!best||score>best.score))best={score,...found,page:page.page,y:line.y};}}
    return best||{};
  }
  function nearestColumn(x,columns){const entries=['debit','credit','balance','amount'].filter(k=>Number.isFinite(columns[k])).map(k=>[k,Math.abs(x-columns[k])]).sort((a,b)=>a[1]-b[1]);return entries[0]?.[0]||null;}
  function amountTokens(line){
    const exact=line.tokens.filter(t=>/^[-+]?\(?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?$/i.test(t.text)).map(t=>({token:t,value:moneyNumber(t.text)})).filter(a=>a.value!==null);
    if(exact.length)return exact;
    const matches=[...line.text.matchAll(amountRx)];return matches.map(m=>{const token=line.tokens.find(t=>t.text.includes(m[0].replace(/\s+(CR|DR)$/i,'')))||line.tokens[line.tokens.length-1];return{token,value:moneyNumber(m[0])};}).filter(a=>a.token&&a.value!==null);
  }
  function rowDate(line,period,previousDate){const full=fullDate(line.text);if(full)return full;return inferYear(partialDate(line.text),period,previousDate);}
  function explicitDirection(text){if(/\bDR\b/i.test(text)||/^\s*-/.test(text)||/^\s*\(/.test(text))return'DEBIT';if(/\bCR\b/i.test(text)||/^\s*\+/.test(text))return'CREDIT';return null;}
  function semanticDirection(text){const t=clean(text).toLowerCase();if(/\b(debit|withdrawal|purchase|payment|fee|charge|atm|direct debit|card purchase|transfer out)\b/.test(t))return'DEBIT';if(/\b(credit|deposit|salary|refund|interest paid|payment received|transfer in)\b/.test(t))return'CREDIT';return null;}

  function parseGeometry(pages){
    const allText=pages.flatMap(p=>p.lines.map(l=>l.text)).join('\n');const period=statementPeriod(allText);const columns=findColumns(pages);const physical=pages.flatMap(p=>p.lines.map(l=>({...l})));const candidates=[];let pending=null;let lastResolvedDate=null;
    for(const line of physical){
      if(!line.text||/^(page\s+\d+|statement period|account number|bsb|opening balance|closing balance)\b/i.test(line.text)&&!partialDate(line.text)&&!fullDate(line.text))continue;
      const date=rowDate(line,period,lastResolvedDate);if(date)lastResolvedDate=date;const amounts=amountTokens(line);const starts=date||partialDate(line.text);
      if(starts){if(pending)candidates.push(pending);pending={lines:[line],date,rawDate:date?null:(partialDate(line.text)?clean(line.text.match(/\b\d{1,2}\s+[A-Za-z]{3,9}\b/)?.[0]):null),amounts:[...amounts],page:line.page};continue;}
      if(pending&&(amounts.length||(!/^(total|summary|fees?)\b/i.test(line.text)&&line.text.length<180))){pending.lines.push(line);pending.amounts.push(...amounts);if(amounts.length&&pending.lines.length>=2){candidates.push(pending);pending=null;}}
    }
    if(pending)candidates.push(pending);

    let previousBalance=null;const rows=[];let valid=0,warning=0,rejected=0;let openingBalance=null,closingBalance=null;
    for(let index=0;index<candidates.length;index++){
      const c=candidates[index];const text=clean(c.lines.map(l=>l.text).join(' '));
      if(isBalanceMarker(text)){const nums=c.amounts.map(a=>Math.abs(Number(a.value))).filter(Number.isFinite);if(/opening/i.test(text)&&nums.length)openingBalance=nums[nums.length-1];if(/closing/i.test(text)&&nums.length)closingBalance=nums[nums.length-1];continue;}
      const date=c.date||inferYear(partialDate(c.rawDate||text),period,index?rows[rows.length-1]?.transaction_date:null);let debit=0,credit=0,balance=null,confidence=0.4,evidence='unresolved';
      const classified=c.amounts.map(a=>({...a,column:nearestColumn(a.token.x,columns)}));
      const debitToken=classified.find(a=>a.column==='debit'&&Math.abs(a.value)>0),creditToken=classified.find(a=>a.column==='credit'&&Math.abs(a.value)>0);const balanceToken=[...classified].reverse().find(a=>a.column==='balance');
      if(balanceToken)balance=Math.abs(balanceToken.value);
      if(debitToken&&!creditToken){debit=Math.abs(debitToken.value);confidence=.99;evidence='debit_column';}
      else if(creditToken&&!debitToken){credit=Math.abs(creditToken.value);confidence=.99;evidence='credit_column';}
      else {
        const usable=classified.filter(a=>a!==balanceToken&&Math.abs(a.value)>0);const a=usable[usable.length-1]||classified.find(x=>Math.abs(x.value)>0);
        if(a){const direction=explicitDirection(a.token.text)||semanticDirection(text);if(direction==='DEBIT'){debit=Math.abs(a.value);confidence=explicitDirection(a.token.text)?1:.9;evidence=explicitDirection(a.token.text)?'explicit_dr_or_sign':'transaction_text';}else if(direction==='CREDIT'){credit=Math.abs(a.value);confidence=explicitDirection(a.token.text)?1:.9;evidence=explicitDirection(a.token.text)?'explicit_cr_or_sign':'transaction_text';}else if(previousBalance!==null&&balance!==null){const delta=Math.round((balance-previousBalance)*100)/100;if(Math.abs(Math.abs(delta)-Math.abs(a.value))<=.02){if(delta<0)debit=Math.abs(a.value);else credit=Math.abs(a.value);confidence=.93;evidence='running_balance_delta';}}}
      }
      if(balance!==null)previousBalance=balance;
      const description=clean(c.lines.flatMap(l=>l.tokens.filter(t=>{amountRx.lastIndex=0;const isAmount=amountRx.test(t.text);amountRx.lastIndex=0;return !isAmount&&!fullDate(t.text)&&!partialDate(t.text);}).map(t=>t.text)).join(' ')).slice(0,500)||'PDF statement transaction';
      let status='VALID',message='';if(!date){status='REJECTED';message='Could not safely determine transaction date';confidence=Math.min(confidence,.4);}else if(!debit&&!credit){status='REJECTED';message='Could not safely determine debit/credit direction';confidence=Math.min(confidence,.6);}else if(confidence<.97){status='WARNING';message=`Direction inferred from ${evidence.replace(/_/g,' ')}`;}
      if(status==='VALID')valid++;else if(status==='WARNING')warning++;else rejected++;
      rows.push({transaction_date:date,description,debit,credit,running_balance:balance,currency:'AUD',parser_confidence:confidence,parser_evidence:evidence,validation_hint:message,source_row_no:index+1});
    }
    const importable=rows.filter(r=>r.transaction_date&&(r.debit>0||r.credit>0));const totalDebit=importable.reduce((s,r)=>s+Number(r.debit||0),0),totalCredit=importable.reduce((s,r)=>s+Number(r.credit||0),0);let reconciliation={status:'UNAVAILABLE',difference:null};if(openingBalance!==null&&closingBalance!==null){const calculated=openingBalance+totalCredit-totalDebit;const diff=Math.round((calculated-closingBalance)*100)/100;reconciliation={status:Math.abs(diff)<=.02?'PASS':'REVIEW_REQUIRED',difference:diff,calculated_closing:calculated};}
    const averageConfidence=rows.length?rows.reduce((s,r)=>s+Number(r.parser_confidence||0),0)/rows.length:0;
    return {rows,metadata:{statement_start_date:period.start,statement_end_date:period.end,opening_balance:openingBalance,closing_balance:closingBalance,parser_version:'PDF_V3_GEOMETRY_2',parser_confidence:averageConfidence,reconciliation_status:reconciliation.status,reconciliation_difference:reconciliation.difference,extraction_diagnostics:{pages:pages.length,candidates:candidates.length,valid,warning,rejected,columns_detected:Object.keys(columns).filter(k=>!['score','page','y'].includes(k)),reconciliation}}};
  }

  async function sha256(file){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function notice(message,tone='info'){const el=document.getElementById('notice');if(!el)return;el.hidden=false;el.className=`notice ${tone}`;el.textContent=message;}

  async function handlePdfSubmit(event){
    const form=event.target;if(!(form instanceof HTMLFormElement)||form.id!=='importForm')return;const file=document.getElementById('importFile')?.files?.[0];if(!file||!file.name.toLowerCase().endsWith('.pdf'))return;
    event.preventDefault();event.stopImmediatePropagation();const accountId=Number(document.getElementById('importAccount')?.value||0);if(!accountId)return;
    const button=form.querySelector('button[type="submit"]');if(button){button.disabled=true;button.textContent='Reading PDF safely…';}
    try{
      const pages=await extractGeometry(file);const parsed=parseGeometry(pages);if(!parsed.rows.length)throw new Error('No transaction candidates could be reconstructed from this PDF. CSV, OFX or QFX will be more reliable for this statement layout.');
      const result=await fetch(`/api/finance/intelligence/accounts/${accountId}/statements/preview`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_format:'PDF',original_name:file.name,content_hash:await sha256(file),rows:parsed.rows,...parsed.metadata})});
      const body=await result.json().catch(()=>({}));if(!result.ok)throw new Error(body.message||`Preview failed (${result.status})`);
      document.getElementById('importDialog')?.close();form.reset();const d=parsed.metadata.extraction_diagnostics;const rebuilt=body.reparsed?' Existing rejected review rows were rebuilt with the current parser.':'';notice(`${body.message}${rebuilt} PDF v3 found ${d.valid} ready, ${d.warning} warning and ${d.rejected} rejected candidate(s). Reconciliation: ${parsed.metadata.reconciliation_status}.`,'success');document.getElementById('openReviewQueue')?.click();
    }catch(e){notice(e.message,'error');}
    finally{if(button){button.disabled=false;button.textContent='Preview statement';}}
  }

  document.addEventListener('submit',handlePdfSubmit,true);
  window.VoxelVedaPdfV3=Object.freeze({extractGeometry,parseGeometry,fullDate,inferYear,statementPeriod,findColumns});
})();