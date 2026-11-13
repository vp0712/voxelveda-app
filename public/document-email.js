(() => {
  'use strict';
  // Manual business documents only. Automatic private staff delivery has its own policy.
  const icon = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>';
  const id = 'vv-document-email';
  let active = null, epoch = 0, catalogOwner=null, catalogPromise=null;
  const account = () => { try { return window.VoxelActions?.account() || String(JSON.parse(localStorage.getItem('user') || '{}').id || '') + '|' + (localStorage.getItem('token') || ''); } catch { return ''; } };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validTo = value => typeof value === 'string' && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
  const requestId = () => crypto.randomUUID();
  function requestHeaders() {
    const headers=new Headers(typeof window.authHeaders==='function'?window.authHeaders():{});
    try{const token=localStorage.getItem('token');if(token&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+token);}catch{}
    return Object.fromEntries(headers.entries());
  }
  async function allowed(source) {
    const owner=account();if(!owner.split('|')[0])return false;
    if(catalogOwner!==owner){catalogOwner=owner;catalogPromise=null;}
    if(!catalogPromise)catalogPromise=fetch('/api/email/reports/catalog',{credentials:'same-origin',cache:'no-store',headers:requestHeaders()}).then(async response=>{if(!response.ok)throw new Error('Report email permissions unavailable.');return response.json();}).catch(()=>{if(catalogOwner===owner)catalogPromise=null;return null;});
    const data=await catalogPromise;if(owner!==account()||!data)return false;
    return (data.reports||[]).some(item=>item.can_email===true&&item.type===source.type&&(!item.report||item.report===source.report)) && (source.type!=='qms-register'||(data.qms_registers||[]).some(item=>item.name===source.register));
  }
  function sourceForPdf(value) {
    let url;try{url=new URL(value,location.origin);}catch{return null;}if(url.origin!==location.origin)return null;
    const filters=Object.fromEntries(url.searchParams);delete filters.download;delete filters.disposition;
    let match;
    if((match=url.pathname.match(/^\/api\/documents\/reports\/([a-z-]+)\.pdf$/)))return{type:'register',report:match[1],filters};
    if((match=url.pathname.match(/^\/api\/invoice\/([1-9][0-9]*)\/pdf$/)))return{type:'invoice',record_id:Number(match[1]),...(Object.keys(filters).length?{filters}:{})};
    if(url.pathname==='/api/invoice/statement/pdf')return{type:'customer-statement',filters};
    if((match=url.pathname.match(/^\/api\/qms\/registers\/([a-z-]+)\/pdf$/)))return{type:'qms-register',register:match[1],filters};
    if((match=url.pathname.match(/^\/api\/qms\/records\/([1-9][0-9]*)\/pdf$/)))return{type:'qms-record',record_id:Number(match[1])};
    if((match=url.pathname.match(/^\/api\/qms\/cocs\/([1-9][0-9]*)\/pdf$/)))return{type:'coc',record_id:Number(match[1])};
    if((match=url.pathname.match(/^\/api\/materials\/([1-9][0-9]*)\/process-sheet\.pdf$/)))return{type:'material-process-sheet',record_id:Number(match[1])};
    if((match=url.pathname.match(/^\/api\/procurement\/purchase-orders\/([1-9][0-9]*)\/pdf$/)))return{type:'purchase-order',record_id:Number(match[1])};
    if((match=url.pathname.match(/^\/api\/procurement\/reports\/snapshots\/([A-Fa-f0-9-]{36})\/pdf$/)))return{type:'procurement',snapshot_id:match[1]};
    // Private employee-week downloads intentionally have no arbitrary-recipient action.
    return null;
  }
  function ensure() {
    if (document.getElementById(id + '-backdrop')) return;
    const el = document.createElement('div'); el.id = id + '-backdrop'; el.className = 'dialog-backdrop vv-document-email';
    el.innerHTML = `<section class="dialog-panel"><h2 id="${id}-title"></h2><div id="${id}-body" class="vv-document-email-body"></div><div class="dialog-actions"><button type="button" class="secondary-btn" id="${id}-cancel">Cancel</button><button type="button" class="primary-btn" id="${id}-send">Send</button></div></section>`;
    document.body.append(el);
  }
  function live(state) { return active === state && state.owner === account() && state.epoch === epoch; }
  function config(state, options) {
    return { id, backdrop:id+'-backdrop', title:id+'-title', body:id+'-body', primary:id+'-send', secondary:id+'-cancel', heading:'Email PDF report',
      onClosed:() => { if (active === state) active = null; }, ...options };
  }
  async function api(path, options, state) {
    const headers=new Headers(requestHeaders());headers.set('Content-Type','application/json');new Headers(options?.headers).forEach((value,key)=>headers.set(key,value));
    const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options, headers });
    if (!live(state)) throw Object.assign(new Error('The signed-in account changed. Reopen this report from your current account.'), { stale:true });
    const data = await response.json().catch(() => null);
    if (!data || !response.ok) throw Object.assign(new Error(data?.message || 'The report service could not confirm the request.'), { status:response.status, code:data?.code, data, uncertain:response.status >= 500 || !data });
    return data;
  }
  function safeUrl(value) { return typeof value === 'string' && /^\/api\/email\/(?:reports|documents)\/[A-Za-z0-9-]+(?:\/pdf)?(?:\?[^#]*)?$/.test(value) ? value : null; }
  function statusText(data) {
    const email = data.email || data.delivery?.email || data.delivery || data;
    if (email.recipient_verified || email.recipient_verified_at) return 'Recipient receipt has been verified.';
    if (email.provider_accepted || email.provider_accepted_at || ['SENT','ACCEPTED','PROVIDER_ACCEPTED'].includes(email.status || email.email_status)) return 'Provider accepted the email. Recipient receipt is not verified.';
    const status = String(email.email_status || email.status || '').toUpperCase();
    if (['UNCERTAIN','REVIEW_REQUIRED','OUTCOME_UNCERTAIN'].includes(status)) return 'Delivery outcome needs review. Do not send another message until the previous outcome has been reconciled.';
    if (status === 'FAILED') return 'Delivery failed. The request is retained; use authorised delivery controls for a controlled retry.';
    if (['PENDING','QUEUED'].includes(status)) return 'PDF validated and email queued. Provider acceptance and recipient receipt are still pending.';
    if (['RETRY','RETRYING'].includes(status)) return 'Email retry is scheduled. Provider acceptance and recipient receipt are still pending.';
    if (['SENDING','PROCESSING'].includes(status)) return 'Email transport is in progress. Provider acceptance and recipient receipt are not confirmed.';
    const generation=String(email.generation_status || data.document?.generation_status || data.generation_status || '').toUpperCase();
    if (status==='GENERATION_FAILED'||generation==='GENERATION_FAILED') return 'PDF generation failed. No new email was queued. The request is retained for a controlled retry.';
    if (status==='GENERATING'||generation==='GENERATING') return 'PDF generation is still in progress. Email has not been queued.';
    if (status==='NOT_QUEUED'||email.email_queued===false&&generation==='VALIDATED') return 'Email has not been queued. Review the retained request before retrying.';
    if (['CANCELLED','SUPPRESSED'].includes(status)) return 'Email delivery was stopped. No new message was queued.';
    return 'Delivery status has not been confirmed. Provider acceptance and recipient receipt are not confirmed; review the retained request before another send.';
  }
  function showPrepared(state) {
    if (!live(state)) return;
    const report = state.report;
    if (!report.can_email || !report.snapshot_id || !/^[a-f0-9]{64}$/i.test(report.sha256 || '') || !safeUrl(report.pdf_url)) throw new Error('This report did not confirm a permitted, validated PDF snapshot. No email was sent.');
    const html = `<p class="vv-document-email-summary"><strong>${escape(report.title || 'Report')}</strong>${report.reference ? '<span>'+escape(report.reference)+'</span>' : ''}</p><p>${state.source.expected_source_hash?'This saved version matches the selected source.':'A saved version has been prepared for email. Review its content before sending.'} The preview, download and email below use this same saved PDF.</p><div class="vv-document-email-doc-actions"><button type="button" class="secondary-btn" data-vv-action-icon="view" data-vv-email-preview>Preview PDF</button><button type="button" class="secondary-btn" data-vv-action-icon="download" data-vv-email-download>Download PDF</button></div><label class="vv-document-email-label" for="vvDocumentEmailTo">To <span aria-hidden="true">*</span></label><input id="vvDocumentEmailTo" name="to" type="email" inputmode="email" autocomplete="email" maxlength="254" required value="${escape(state.to || '')}" aria-describedby="vvDocumentEmailPrivacy"><p id="vvDocumentEmailPrivacy" class="vv-document-email-help">Enter one authorised recipient. No CC, BCC or automatic company copy is added.</p><p id="vvDocumentEmailStatus" role="status" aria-live="polite"></p>`;
    // Replacing the loading dialog is deliberate; it contains no editable values.
    window.VoxelDialog.close(id);
    active = state;
    const opened = window.VoxelDialog.open(config(state, { mode:'editable', html, primaryText:'Send', busyText:'Queueing…',
      validate:() => {
        const field = document.getElementById('vvDocumentEmailTo'); state.to = field.value.trim();
        return validTo(state.to) || window.VoxelDialog.validate(document.getElementById(id+'-body'), [{field,message:'Enter exactly one valid authorised email address.'}]);
      }, onPrimary:async () => {
        if (!live(state) || state.attempting || state.uncertain || state.completed) return;
        const field = document.getElementById('vvDocumentEmailTo'); state.to = field.value.trim();
        if (!validTo(state.to)) return;
        state.attempting = true;
        try {
          const result = await api('/api/email/reports/'+encodeURIComponent(report.snapshot_id)+'/send', {method:'POST',body:JSON.stringify({to:state.to,expected_sha256:report.sha256,request_id:state.requestId})}, state);
          if (!live(state)) return;
          const emailStatus=String(result.email_status||result.status||'').toUpperCase(),accepted=Boolean(result.provider_accepted||['SENT','ACCEPTED','PROVIDER_ACCEPTED'].includes(emailStatus));
          if(!accepted&&!['PENDING','QUEUED','RETRY','RETRYING','SENDING','PROCESSING'].includes(emailStatus))throw Object.assign(new Error(statusText(result)),{status:409,code:'DELIVERY_STATUS_HOLD',data:result});
          state.completed = true; window.VoxelDialog.markCommitted(); window.VoxelDialog.close(id);
          await window.VoxelFeedback?.show({kind:accepted?'success':'info',title:accepted?'Provider accepted':['RETRY','RETRYING'].includes(emailStatus)?'Retry scheduled':['SENDING','PROCESSING'].includes(emailStatus)?'Sending in progress':'Email queued',message:statusText(result),actions:[{label:'OK'}]});
        } catch (error) {
          if (!live(state) || error.stale) return;
          const previous=error.data?.existing_delivery||(error.data?.email_status?error.data:null);
          const documentId=Number(error.data?.document_request_id||previous?.document_request_id);
          state.reviewUrl=safeUrl(previous?.delivery_status_url||error.data?.delivery_status_url)||(Number.isSafeInteger(documentId)&&documentId>0?'/api/email/documents/'+documentId:null);
          if (previous||error.uncertain || !error.status || /UNCERTAIN|REVIEW_REQUIRED|EXISTING_DELIVERY|DELIVERY_STATUS_HOLD/.test(error.code || '')) { state.uncertain = true; window.VoxelDialog.markUncertain(); }
          const status = document.getElementById('vvDocumentEmailStatus');
          if (status) { status.textContent = previous?statusText(previous)+' No second message was queued.':state.uncertain ? 'The send outcome needs review. No automatic retry was made. Check the retained delivery status before another send.' : error.message+' Your recipient has been kept.'; status.className='vv-document-email-error'; }
          if (state.uncertain) addStatusCheck(state);
          throw error;
        } finally { state.attempting = false; }
      } }));
    if (!opened) { if (active === state) active = null; return; }
    const body = document.getElementById(id+'-body');
    body.querySelector('[data-vv-email-preview]').onclick = () => documentAction(state, false);
    body.querySelector('[data-vv-email-download]').onclick = () => documentAction(state, true);
    document.getElementById('vvDocumentEmailTo').focus();
  }
  async function documentAction(state, download) {
    if (!live(state)) return;
    try { await window.VoxelOperations.openPdf(state.report.pdf_url, {download,headers:requestHeaders()}); }
    catch (error) { if (live(state)) void window.VoxelFeedback?.show({kind:'error',title:'PDF unavailable',message:error.message}); }
  }
  function addStatusCheck(state) {
    const body = document.getElementById(id+'-body'); if (!body || body.querySelector('[data-vv-email-check]')) return;
    const button = document.createElement('button'); button.type='button'; button.className='secondary-btn';button.dataset.vvEmailCheck='';button.textContent='Check saved delivery status';body.append(button);
    button.onclick = async () => {
      if (!live(state) || button.disabled) return; button.disabled=true;
      try { const data=await api(state.reviewUrl||'/api/email/reports/'+encodeURIComponent(state.report.snapshot_id)+'?request_id='+encodeURIComponent(state.requestId),{},state);const send=data.sends?.find(item=>item.client_request_id===state.requestId);if(live(state))document.getElementById('vvDocumentEmailStatus').textContent=send?statusText(send):data.delivery || data.email || data.email_status || state.reviewUrl ? statusText(data) : 'No confirmed delivery outcome is available yet. Keep this request on hold and ask an authorised reviewer to reconcile it.'; }
      catch(error){if(live(state))document.getElementById('vvDocumentEmailStatus').textContent='Status could not be confirmed. Keep this request on hold; do not resend.';}
      finally{if(live(state))button.disabled=false;}
    };
  }
  async function open(source, options={}) {
    if (!source || typeof source !== 'object' || !source.type) return false;
    if (active) { document.getElementById(id+'-send')?.focus(); return false; }
    if (!window.VoxelDialog || !account().split('|')[0]) { void window.VoxelFeedback?.show({kind:'error',title:'Sign in required',message:'Open this report from your signed-in account.'});return false; }
    ensure();
    const state={owner:account(),epoch,source:{...source},to:options.to || '',requestId:requestId(),attempting:false};active=state;
    if (!window.VoxelDialog.open(config(state,{mode:'readonly',heading:'Prepare email report',html:'<p role="status">Checking your permission and saving the report version… No email has been sent.</p>'}))) { active=null;return false; }
    try {
      const result=await api('/api/email/reports/prepare',{method:'POST',body:JSON.stringify(state.source)},state);
      if (!live(state)) return false;state.report=result;showPrepared(state);return true;
    } catch(error) {
      if(!live(state)||error.stale)return false;
      const body=document.getElementById(id+'-body');body.replaceChildren();const note=document.createElement('p');note.className='vv-document-email-error';note.setAttribute('role','alert');note.textContent=error.message+' No email was sent.';body.append(note);
      const retry=document.createElement('button');retry.type='button';retry.className='secondary-btn';retry.textContent='Retry preparation';body.append(retry);retry.onclick=()=>{if(!live(state))return;window.VoxelDialog.close(id);void open(source,options);};return false;
    }
  }
  function button(source, options={}) {
    const el=document.createElement('button');el.type='button';el.className='secondary-btn vv-document-email-button';el.dataset.vvActionIcon='email';el.innerHTML=icon+'<span>'+escape(options.label || 'Email PDF')+'</span>';el.setAttribute('aria-label',options.ariaLabel || 'Email this report');el.title=options.ariaLabel || 'Email this report';el.hidden=true;
    const value=()=>typeof source==='function'?source():source;
    void allowed(value()||{}).then(permitted=>{if(permitted)el.hidden=false;});
    el.onclick=()=>{const descriptor=value();if(descriptor)void open(descriptor,options);};return el;
  }
  function mountPreview(source, options={}) {
    const actions=document.querySelector('.document-reader header .actions');if(!actions||actions.querySelector('.vv-document-email-button')||!source)return;
    actions.append(button(source,options));
  }
  function decorate(root=document) {
    for(const control of root.querySelectorAll('button[onclick]')) {
      if(control.dataset.vvEmailCompanion)continue;const handler=control.getAttribute('onclick')||'';let source=null,match;
      if((match=handler.match(/^(?:return\s+)?downloadCsv\(['"]([a-z]+)['"]\)/)))source={type:'register',report:match[1]==='users'?'staff':match[1]};
      else if(/^(?:return\s+)?exportRosterCsv\(/.test(handler))source=()=>({type:'register',report:'roster',filters:{from_date:document.getElementById('rosterFromDate')?.value||'',to_date:document.getElementById('rosterToDate')?.value||''}});
      else if(/^(?:return\s+)?exportTimesheetCsv\(/.test(handler))source=()=>({type:'register',report:'timesheets',filters:typeof window.originalTimesheetQuery==='function'?window.originalTimesheetQuery():{}});
      else if((match=handler.match(/^(?:return\s+)?openStaffInvoicePdf\(([1-9][0-9]*)\)/)))source={type:'invoice',record_id:Number(match[1])};
      else if((match=handler.match(/^(?:return\s+)?openProcessSheetPdf\(([1-9][0-9]*)\)/)))source={type:'material-process-sheet',record_id:Number(match[1])};
      if(!source)continue;control.dataset.vvEmailCompanion='true';control.after(button(source));
    }
    for(const link of root.querySelectorAll('a[href^="/api/"][href*="pdf"]')){if(link.dataset.vvEmailCompanion)continue;const source=sourceForPdf(link.getAttribute('href'));if(!source)continue;link.dataset.vvEmailCompanion='true';link.after(button(source));}
    if(typeof window.getOriginalReportEmailSource==='function')for(const [section,report] of Object.entries({rfqSection:'rfqs',invoiceSection:'invoices',customerSection:'customers',supplierSection:'suppliers',stockSection:'stock',rawMaterialSection:'raw-materials',packagingSection:'packaging',staffSection:'staff',competitorSection:'competitors',expenseSection:'expenses'})){
      const target=document.getElementById(section)?.querySelector('.section-head,.invoice-register-actions');if(!target||target.dataset.vvEmailRegister)continue;target.dataset.vvEmailRegister='true';target.append(button(()=>window.getOriginalReportEmailSource(report),{label:'Email register',ariaLabel:'Email the complete filtered '+report.replaceAll('-',' ')+' register'}));
    }
  }
  function clear() { epoch++;active=null;catalogOwner=null;catalogPromise=null;document.querySelectorAll('.vv-document-email-button').forEach(el=>el.hidden=true);const body=document.getElementById(id+'-body');body?.replaceChildren();window.VoxelDialog?.close(id); }
  for (const name of ['vv:auth-changed','vv:avatar-clear','vv:avatar-auth-required']) window.addEventListener(name,clear);
  window.addEventListener('storage',event=>{if(!event.key||['user','token'].includes(event.key))clear();});
  document.addEventListener('DOMContentLoaded',()=>{decorate();new MutationObserver(records=>{if(records.some(record=>record.addedNodes.length))decorate();}).observe(document.body,{childList:true,subtree:true});});
  window.VoxelDocumentEmail={open,button,icon,validTo,sourceForPdf,mountPreview};
})();
