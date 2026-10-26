(() => {
 'use strict';
 const $=id=>document.getElementById(id),out=$('apiOutput'),state=$('systemState');
 const legacy={
  '/api/qms/ncrs':'ncrs','/api/qms/capas':'capas','/api/qms/holds':'holds','/api/qms/inspections/plans':'inspection-plans','/api/qms/cocs':'cocs','/api/qms/documents':'documents',
  '/api/qms/enterprise/audits':'audits','/api/qms/enterprise/management-reviews':'management-reviews','/api/qms/enterprise/regulatory-reviews':'regulatory-reviews',
  '/api/qms/enterprise/continuity':'continuity-exercises','/api/qms/enterprise/chemicals':'chemicals','/api/qms/enterprise/visitors/active':'visitors','/api/qms/enterprise/notifications':'notifications'
 };
 const current={name:null,route:null,recordId:null,metadata:null,page:1,pagination:null,epoch:0,reportEpoch:0,identityEpoch:0,owner:owner(),catalog:[],artifact:null,reportPromise:null,pdfRender:null};
 function owner(){try{return String(JSON.parse(localStorage.getItem('user')||'{}').id||'')+'|'+String(localStorage.getItem('token')||'');}catch{return '';}}
 function accountSafe(captured,identity=current.identityEpoch){return identity===current.identityEpoch&&captured===owner()&&captured===current.owner;}
 function show(value){out.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);}
 function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el;}
 async function api(url,opts={}){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
  const data=await r.json().catch(()=>({message:'The service returned an unreadable response. Retry.'}));
  if(r.status===401){resetAccount();location.href='/login?returnTo='+encodeURIComponent(location.pathname+location.search);throw new Error('Sign in again.');}
  if(!r.ok)throw Object.assign(new Error(data.message||'The request could not be completed.'),{data,status:r.status});
  return data;
 }
 function invalidateArtifact(){current.reportEpoch++;const a=current.artifact;current.artifact=null;if(a){a.pdf?.destroy?.();URL.revokeObjectURL(a.url);}current.pdfRender?.cancel?.();current.pdfRender=null;$('registerReportStatus').textContent='';}
 function resetAccount(){
  current.epoch++;current.identityEpoch++;current.owner=owner();invalidateArtifact();current.name=null;current.metadata=null;current.catalog=[];current.reportPromise=null;for(const id of ['notifyBtn','drillBtn','importLegacyBtn']){$(id).hidden=true;$(id).disabled=false;}
  $('registerTable').replaceChildren();$('qualityRegister').hidden=true;$('metricGrid').replaceChildren();show('Sign in to load your permitted quality records.');
  window.VoxelDialog?.close('quality-report',{user:false});
 }
 function metric(label,value){const d=node('div');d.className='metric';d.append(node('small',label),node('strong',value??0));return d;}
 async function load(){
  const captured=current.owner,identity=current.identityEpoch;
  try{
   const [health,cc]=await Promise.all([fetch('/api/health',{cache:'no-store'}).then(r=>r.json()),api('/api/qms/enterprise/command-centre')]);
   if(!accountSafe(captured,identity))return;
   state.textContent=health.status==='ok'?'Active':'Attention';state.classList.toggle('high',health.status!=='ok');
   const labels={openNcr:'Open NCR',openCapa:'Open CAPA',qualityHolds:'Quality Holds',overdueCalibration:'Calibration Overdue',overdueMaintenance:'Maintenance Overdue',trainingDue:'Training Due ≤30d',openScars:'Open SCAR',openAuditFindings:'Audit Findings',documentReviewsDue:'Document Reviews Due',activeVisitors:'Active Visitors',openRegulatoryReviews:'Regulatory Reviews',unacknowledgedNotifications:'QMS Alerts'};
   $('metricGrid').replaceChildren(...Object.entries(cc.metrics||{}).map(([key,value])=>metric(labels[key]||key,value)));
  }catch(e){if(accountSafe(captured,identity)){state.textContent='Access / service check required';show(e.data||e.message);}}
 }
 async function catalog(){
  const captured=current.owner,identity=current.identityEpoch;
  const data=await api('/api/qms/registers');if(!accountSafe(captured,identity))return;
  $('notifyBtn').hidden=!data.capabilities?.generate_alerts;$('drillBtn').hidden=!data.capabilities?.start_drill;$('importLegacyBtn').hidden=!data.capabilities?.import_legacy;current.catalog=data.registers||[];$('registerSelect').replaceChildren(...current.catalog.map(meta=>{const o=node('option',meta.title);o.value=meta.name;return o;}));if(current.name)$('registerSelect').value=current.name;
 }
 function settings(meta){
  current.metadata=meta;$('registerTitle').textContent=meta.title;$('registerSelect').value=meta.name;
  const form=$('registerExtraFilters');form.replaceChildren();
  for(const [key,values] of Object.entries(meta.filters||{})){
   const label=node('label',key.replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase()));const input=values?node('select'):node('input');input.name=key;input.dataset.registerFilter=key;
   if(values){const empty=node('option','Any');empty.value='';input.append(empty,...values.map(value=>{const o=node('option',value.replace(/_/g,' '));o.value=value;return o;}));if(key==='acknowledged')input.value='open';}
   else{input.type='text';input.maxLength=120;}
   label.append(input);form.append(label);
  }
  $('registerSort').replaceChildren(...meta.sorts.map(key=>{const o=node('option',meta.columns.find(column=>column.key===key)?.label||(key==='id'?'Record order':key===meta.date_field?meta.date_label:key.replace(/_/g,' ')));o.value=key;return o;}));$('registerSort').value=meta.default_sort;$('registerDirection').value=meta.default_direction;
  $('registerFromLabel').firstChild.textContent=(meta.date_label||'Recorded')+' from date';$('registerToLabel').firstChild.textContent=(meta.date_label||'Recorded')+' to date';$('registerFromLabel').hidden=!meta.date_field;$('registerToLabel').hidden=!meta.date_field;$('registerFrom').value='';$('registerTo').value='';$('registerSearch').value='';
 }
 function selection(){
  const q=new URLSearchParams();for(const [id,key] of [['registerSearch','search'],['registerSort','sort'],['registerDirection','direction'],['registerFrom','from_date'],['registerTo','to_date']]){if($(id).value)q.set(key,$(id).value);}
  if(current.recordId)q.set('id',current.recordId);$('registerExtraFilters').querySelectorAll('[data-register-filter]').forEach(field=>{if(field.value)q.set(field.name,field.value);});return q;
 }
 function dateLabel(value){
  if(!value)return '—';const raw=String(value).slice(0,10),date=new Date(raw+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('en-AU',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
 }
 function renderRows(data){
  const meta=data.register,rows=data[meta.key];if(!Array.isArray(rows)||!data.pagination)throw new Error('The register did not confirm its records and count. Retry.');
  current.pagination=data.pagination;$('registerTitle').textContent=meta.title;
  const {page,limit,total,pages}=data.pagination;$('registerSummary').textContent=total?total.toLocaleString()+' authorised '+(total===1?'record':'records')+' match the selected filters.':'No records match these filters.';
  $('registerPage').textContent='Page '+page+' of '+Math.max(1,pages);$('registerPrevious').disabled=page<=1;$('registerNext').disabled=page>=pages;
  const table=node('table');table.className='quality-register-table';const thead=node('thead'),heading=node('tr');meta.columns.forEach(c=>{const th=node('th',c.label);th.scope='col';heading.append(th);});thead.append(heading);
  const tbody=node('tbody');for(const row of rows){const tr=node('tr');for(const column of meta.columns){const td=node('td');td.dataset.label=column.label;const value=row[column.key];td.append(node('span',column.type==='date'?dateLabel(value):value??'—'));tr.append(td);}tbody.append(tr);}
  table.append(thead,tbody);$('registerTable').replaceChildren(rows.length?table:node('p','No saved records match this selection. Change the filters or choose another register.'));
  $('registerPreview').disabled=false;$('registerDownload').disabled=false;
  // The original output region remains a concise accessible feed for existing portal links.
  show(rows.length?'Loaded '+rows.length+' of '+total+' '+meta.title.toLowerCase()+'. '+String(rows[0][meta.columns[0].key]||''):'No records match this selection.');
 }
 async function loadRegister(name,{page=1,route=null,reset=false}={}){
  const captured=current.owner,epoch=++current.epoch;invalidateArtifact();current.name=name;current.route=route||current.route;current.page=page;$('registerAll').hidden=!current.recordId;$('qualityRegister').hidden=false;
  if(reset||current.metadata?.name!==name){const meta=current.catalog.find(item=>item.name===name);if(meta)settings(meta);}
  $('registerError').hidden=true;$('registerSummary').textContent='Loading saved records…';$('registerTable').setAttribute('aria-busy','true');$('registerPrevious').disabled=true;$('registerNext').disabled=true;$('registerPreview').disabled=true;$('registerDownload').disabled=true;show('Loading…');
  try{
   const q=selection();q.set('page',String(page));q.set('limit','25');const path=route||Object.keys(legacy).find(key=>legacy[key]===name)||'/api/qms/registers/'+encodeURIComponent(name);
   const data=await api(path+'?'+q);if(!accountSafe(captured)||epoch!==current.epoch)return;
   if(!current.metadata||current.metadata.name!==data.register?.name){const saved=q;settings(data.register);for(const [key,value] of saved){const field=$('registerFilters').elements.namedItem(key);if(field)field.value=value;}}
   renderRows(data);
  }catch(error){if(accountSafe(captured)&&epoch===current.epoch){$('registerError').textContent=error.message+' Your filters have been kept. Use Refresh to retry.';$('registerError').hidden=false;$('registerSummary').textContent='Records could not be loaded.';$('registerTable').replaceChildren();show(error.message);}}
  finally{if(accountSafe(captured)&&epoch===current.epoch)$('registerTable').removeAttribute('aria-busy');}
 }
 async function artifact(){
  const captured=current.owner,identity=current.identityEpoch,reportEpoch=current.reportEpoch,key=current.name+'?'+selection().toString();
  if(current.artifact?.key===key)return current.artifact;
  if(current.reportPromise)return current.reportPromise;
  const name=current.name,query=selection().toString();$('registerPreview').disabled=true;$('registerDownload').disabled=true;$('registerReportStatus').textContent='Generating the complete authorised PDF selection…';
  const task=(async()=>{
   const response=await fetch('/api/qms/registers/'+encodeURIComponent(name)+'/pdf?'+query,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'The PDF could not be generated. No file was downloaded.');}
   if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/pdf')throw new Error('The service did not return a PDF. No file was downloaded.');
   const filename=response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9._ -]+\.pdf)"/i)?.[1];if(!filename)throw new Error('The PDF filename was invalid. No file was downloaded.');
   const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(response.headers.get('x-document-sha256')!==sha)throw new Error('The report bytes could not be verified. Retry generating the PDF.');
   const pdfjs=await import('/vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
   const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),isEvalSupported:false,enableXfa:false,standardFontDataUrl:'/vendor/pdf-fonts/'}).promise;
   if(!pdf.numPages)throw new Error('The PDF has no readable pages.');
   const first=await pdf.getPage(1),text=await first.getTextContent();if(!text.items.map(i=>i.str).join(' ').includes(current.metadata.title)){await pdf.destroy();throw new Error('The generated PDF did not identify the selected register.');}
   if(!accountSafe(captured,identity)||reportEpoch!==current.reportEpoch||key!==current.name+'?'+selection().toString()){await pdf.destroy();throw new Error('The selected account or filters changed. Generate the report again.');}
   const result={key,bytes,pdf,filename,sha,sourceHash:response.headers.get('x-document-source-sha256'),count:Number(response.headers.get('x-document-record-count')),url:URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))};current.artifact=result;$('registerReportStatus').textContent=result.count+' matching records · '+pdf.numPages+' PDF pages. Preview and download use this same generated document.';return result;
  })();
  current.reportPromise=task;try{return await task;}finally{if(current.reportPromise===task)current.reportPromise=null;if(accountSafe(captured,identity)){$('registerPreview').disabled=false;$('registerDownload').disabled=false;}}
 }
 async function previewReport(){
  try{
   const a=await artifact();let page=1,zoom=1,renderEpoch=0;
   const html='<div class="quality-pdf-controls"><button id="qualityPdfPrevious" type="button">Previous page</button><span id="qualityPdfPage"></span><button id="qualityPdfNext" type="button">Next page</button><button id="qualityPdfSmaller" type="button" aria-label="Zoom out">−</button><button id="qualityPdfLarger" type="button" aria-label="Zoom in">+</button><button id="qualityPdfFit" type="button">Fit width</button><button id="qualityPdfDownload" type="button">Download PDF</button></div><p id="qualityPdfStatus" role="status"></p><div id="qualityPdfStage" tabindex="0" aria-label="PDF document page"><canvas id="qualityPdfCanvas" aria-label="Rendered PDF page"></canvas></div>';
   if(!window.VoxelDialog?.open({id:'quality-report',backdrop:'qualityPdfBackdrop',title:'qualityPdfTitle',body:'qualityPdfBody',primary:'qualityPdfClose',secondary:'qualityPdfCancel',heading:current.metadata.title,mode:'readonly',html,onClosed:()=>{renderEpoch++;current.pdfRender?.cancel?.();current.pdfRender=null;current.onPdfResize=null;}}))throw new Error('Close the current dialog before opening the report.');
   async function render(){
    const epoch=++renderEpoch;current.pdfRender?.cancel?.();try{
     const source=await a.pdf.getPage(page);if(epoch!==renderEpoch||current.artifact!==a)return;const stage=$('qualityPdfStage'),canvas=$('qualityPdfCanvas');if(!stage||!canvas)return;
     const base=source.getViewport({scale:1}),viewport=source.getViewport({scale:Math.max(100,stage.clientWidth-20)/base.width*zoom}),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=Math.ceil(viewport.width)+'px';canvas.style.height=Math.ceil(viewport.height)+'px';
     $('qualityPdfPage').textContent='Page '+page+' of '+a.pdf.numPages;$('qualityPdfPrevious').disabled=page<=1;$('qualityPdfNext').disabled=page>=a.pdf.numPages;
     current.pdfRender=source.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});await current.pdfRender.promise;if(epoch===renderEpoch&&$('qualityPdfStatus'))$('qualityPdfStatus').textContent='Page '+page+' is ready.';
    }catch(error){if(error.name!=='RenderingCancelledException'&&$('qualityPdfStatus'))$('qualityPdfStatus').textContent='This page could not be rendered. Download the validated PDF or reopen the preview.';}
   }
   $('qualityPdfPrevious').onclick=()=>{page=Math.max(1,page-1);void render();};$('qualityPdfNext').onclick=()=>{page=Math.min(a.pdf.numPages,page+1);void render();};$('qualityPdfSmaller').onclick=()=>{zoom=Math.max(.5,zoom-.25);void render();};$('qualityPdfLarger').onclick=()=>{zoom=Math.min(3,zoom+.25);void render();};$('qualityPdfFit').onclick=()=>{zoom=1;void render();};$('qualityPdfDownload').onclick=()=>downloadArtifact(a);current.onPdfResize=()=>{zoom=1;void render();};void render();
  }catch(error){$('registerReportStatus').textContent=error.message;void window.VoxelFeedback?.show({kind:'error',title:'PDF unavailable',message:error.message});}
 }
 function downloadArtifact(a){if(current.artifact!==a)return;if(window.VoxelNativeApp)return window.VoxelNativeApp.documentAction(a.bytes,a.filename,true).catch(error=>{$('registerReportStatus').textContent=error.message;});const link=node('a');link.href=a.url;link.download=a.filename;document.body.append(link);link.click();link.remove();}
 $('registerFilters').addEventListener('submit',event=>{event.preventDefault();void loadRegister(current.name,{page:1});});
 $('registerFilters').addEventListener('input',invalidateArtifact);
 $('registerSelect').addEventListener('change',()=>{const name=$('registerSelect').value;current.recordId=null;settings(current.catalog.find(meta=>meta.name===name));void loadRegister(name,{page:1,reset:true});});
 $('registerAll').onclick=()=>{current.recordId=null;void loadRegister(current.name,{page:1});};
 $('registerPrevious').onclick=()=>void loadRegister(current.name,{page:Math.max(1,current.page-1)});$('registerNext').onclick=()=>void loadRegister(current.name,{page:current.page+1});$('registerRefresh').onclick=()=>void loadRegister(current.name,{page:current.page});$('registerPreview').onclick=()=>void previewReport();$('registerDownload').onclick=async()=>{try{downloadArtifact(await artifact());}catch(error){$('registerReportStatus').textContent=error.message;}};
 document.querySelectorAll('[data-api]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();const name=legacy[link.dataset.api];if(name){current.recordId=null;void loadRegister(name,{page:1,route:link.dataset.api,reset:true});}}));
 $('refreshBtn').onclick=()=>{void load();if(current.name)void loadRegister(current.name,{page:current.page});};$('closeOutput').onclick=()=>show('Select a register above.');
 $('recallBtn').onclick=async()=>{const id=$('materialLotId').value.trim();if(!/^\d+$/.test(id)){$('impactResult').textContent='Enter a numeric material lot ID.';return;}try{$('impactResult').textContent=JSON.stringify(await api('/api/qms/enterprise/recall/material/'+encodeURIComponent(id)),null,2);}catch(error){$('impactResult').textContent=error.message;}};
 async function command(id,work){
  const button=$(id);if(button.disabled)return;const captured=current.owner,identity=current.identityEpoch;const valid=()=>accountSafe(captured,identity);button.disabled=true;
  try{await work(valid);}catch(error){if(valid())show(error.data||error.message);}finally{if(valid())button.disabled=false;}
 }
 $('notifyBtn').onclick=()=>void command('notifyBtn',async valid=>{const result=await api('/api/qms/enterprise/notifications/generate',{method:'POST',body:'{}'});if(!valid())return;show(result);invalidateArtifact();await load();if(valid()&&current.name==='notifications')await loadRegister('notifications');});
 $('drillBtn').onclick=()=>void command('drillBtn',async valid=>{const result=await api('/api/qms/enterprise/emergencies',{method:'POST',body:JSON.stringify({event_type:'DRILL',title:'Emergency readiness drill '+new Date().toLocaleString()})});if(!valid())return;show({...result,note:'Emergency roll-call snapshot saved.'});invalidateArtifact();await load();});
 $('importLegacyBtn').onclick=()=>void command('importLegacyBtn',async valid=>{let records=[];try{records=JSON.parse(localStorage.getItem('voxelVedaCompanyFormRecordsV1')||'[]');}catch{}if(!Array.isArray(records)||!records.length){show('No legacy browser form records were found. Nothing was changed.');return;}const remaining=Math.max(0,records.length-250);if(remaining)records=records.slice(0,250);const result=await api('/api/qms/records/import-legacy',{method:'POST',body:JSON.stringify({records})});if(!valid())return;show({...result,note:'Saved browser records were not deleted. Previously imported records are skipped.'+(remaining?' '+remaining+' additional browser records remain for a subsequent reviewed import.':'')});invalidateArtifact();await load();if(valid()&&current.name==='records')await loadRegister('records');});
 for(const event of ['vv:auth-changed','vv:avatar-clear','vv:avatar-auth-required'])window.addEventListener(event,resetAccount);
 window.addEventListener('storage',event=>{if(!event.key||['token','user'].includes(event.key))resetAccount();});
 let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>current.onPdfResize?.(),100);});
 window.addEventListener('pagehide',invalidateArtifact);
 void load();void catalog().then(()=>{const query=new URLSearchParams(location.search),requested=query.get('register');if(!requested)return;const name=({capa:'capas','supplier-quality':'supplier-scars'})[requested]||requested;if(!current.catalog.some(meta=>meta.name===name)){show('This quality link is unavailable. Choose a permitted register above or ask your supervisor to review the reference.');return;}const id=query.get('record_id');if(id){if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id))){show('This record reference is invalid. Choose the record from a quality register.');return;}current.recordId=id;}void loadRegister(name,{page:1,reset:true});}).catch(error=>show(error.message));
 window.VoxelQualityRegisters={refresh:()=>current.name&&loadRegister(current.name,{page:current.page}),get report(){return current.artifact?{filename:current.artifact.filename,sha256:current.artifact.sha,sourceHash:current.artifact.sourceHash,records:current.artifact.count,pages:current.artifact.pdf.numPages}:null;}};
})();
