(() => {
 'use strict';
 const platform=window.Capacitor;
 const plugin=platform?.Plugins?.VoxelVedaApp;
 if(!platform?.isNativePlatform?.()||!plugin)return;
 const canonical='https://app.voxelveda.com';
 if(location.origin!==canonical)return;
 let backDecision=null,discardConsent=null,legacyBackConsent=null;
 const owner=()=>{try{return window.VoxelActions?.account?.()||String(JSON.parse(localStorage.getItem('user')||'{}').id||'')+'|'+(localStorage.getItem('token')||'');}catch{return '';}};
 const formValues=form=>JSON.stringify([...form.elements].map(field=>[field.name||field.id||field.type,field.type==='checkbox'||field.type==='radio'?field.checked:field.value,field.type==='file'?[...field.files].map(file=>[file.name,file.size,file.lastModified]):null]));
 const unchanged=decision=>decision.form.isConnected&&decision.owner===owner()&&decision.values===formValues(decision.form);
 function allowDiscardOnUnload(form){const consent=discardConsent;discardConsent=null;return Boolean(consent&&consent.form===form&&unchanged(consent));}
 function takeBackDecision(requestId){
  const decision=backDecision;if(!decision||decision.requestId!==requestId)return null;
  if(decision.state==='pending')return 'pending';
  backDecision=null;
  if(decision.state!=='confirmed'||!unchanged(decision))return 'cancelled';
  discardConsent=decision;return 'continue';
 }
 function confirmDiscard(form,options){
  if(backDecision)return;
  if(typeof window.VoxelFeedback?.confirm!=='function')return; // Keep unsaved values when the shared UI is unavailable.
  const decision={form,values:formValues(form),owner:owner(),requestId:typeof options.requestId==='string'?options.requestId:null,state:'pending'};
  backDecision=decision;
  Promise.resolve().then(()=>window.VoxelFeedback.confirm('Your entered values have not been saved.',{title:'Discard unsaved changes?',confirmLabel:'Discard changes'})).then(confirmed=>{
   if(backDecision!==decision)return;
   decision.state=confirmed&&unchanged(decision)?'confirmed':'cancelled';
   if(decision.requestId)return; // Android resumes the original Back only after reading this one-shot decision.
   backDecision=null;
   if(decision.state!=='confirmed')return;
   // Previously installed bridges do not understand managed Back decisions.
   // Retain history navigation; never pretend an unsupported native close succeeded.
   if(options.canGoBack!==false){discardConsent=decision;history.back();}
   else {legacyBackConsent=decision;window.VoxelFeedback.notify?.('Press Back again to close this screen without saving. New edits will require confirmation again.',{kind:'info',background:true});}
  }).catch(()=>{if(backDecision===decision)backDecision=null;});
 }
 const base64=bytes=>{const input=new Uint8Array(bytes);let value='';for(let n=0;n<input.length;n+=16384)value+=String.fromCharCode(...input.subarray(n,n+16384));return btoa(value);};
 async function documentAction(bytes,filename,download=false){
  if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}\.pdf$/.test(filename)||bytes.byteLength<100||new TextDecoder('ascii').decode(bytes.slice(0,5))!=='%PDF-')throw new Error('The document is not a valid PDF. No file was saved.');
  const data={filename,base64:base64(bytes)};
  return download?plugin.savePdf(data):plugin.presentPdf(data);
 }
 async function openDocument(value,download=false){
  const url=new URL(value,canonical);
  if(url.origin!==canonical||url.username||url.password)throw new Error('Open documents from your authorised Voxel Veda record.');
  const response=await fetch(url.href,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error(response.status===401?'Your session has ended. Log in again before opening this document.':'The document could not be loaded. Return to its record and retry.');
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/pdf')throw new Error('The service did not return a PDF. No file was saved.');
  const filename=(response.headers.get('content-disposition')||'').match(/filename="?([^";]+)"?/i)?.[1];
  return documentAction(await response.arrayBuffer(),filename,download);
 }
 function handleBack(options={}){
  const security=document.getElementById('stepUpDialog');
  if(security&&!security.hidden){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}
  if(window.VoxelOverlay?.active){window.VoxelOverlay.close();return true;}
  const menu=document.querySelector('.record-action-menu[open]');if(menu){menu.open=false;return true;}
  if(document.body.classList.contains('mobile-menu-open')){window.toggleMobileMenu?.(false);window.toggleStaffMobileMenu?.(false);return true;}
  if(legacyBackConsent){const consent=legacyBackConsent;legacyBackConsent=null;if(unchanged(consent)){discardConsent=consent;return false;}}
  const dirty=[...document.forms].find(form=>{if(typeof form.nativeHasUnsavedChanges==='function'){try{return form.nativeHasUnsavedChanges()===true;}catch{}}return form.dataset.nativeDirty==='true';});
  if(dirty){confirmDiscard(dirty,options);return true;}
  if(backDecision)return true;
  return false;
 }
 window.VoxelNativeApp={handleBack,takeBackDecision,allowDiscardOnUnload,documentAction,openDocument,openCameraSettings:()=>plugin.openCameraSettings()};
 window.addEventListener('pagehide',()=>{backDecision=null;discardConsent=null;legacyBackConsent=null;});
 document.addEventListener('input',event=>{const form=event.target.closest?.('form');if(form)form.dataset.nativeDirty='true';},true);
 document.addEventListener('submit',event=>{if(event.target.matches?.('form'))delete event.target.dataset.nativeDirty;},true);
 function appearance(){plugin.setAppearance({dark:document.documentElement.dataset.colorMode==='dark'}).catch(()=>{});}
 new MutationObserver(appearance).observe(document.documentElement,{attributes:true,attributeFilter:['data-color-mode']});
 appearance();
 if(['/profile','/security','/account'].includes(location.pathname))plugin.getAppInfo().then(info=>{
  if(document.getElementById('androidAppInfo'))return;
  const section=document.createElement('section');section.id='androidAppInfo';section.className='profile-card native-app-information';
  const heading=document.createElement('h2');heading.textContent='App information';section.append(heading);
  for(const [label,value]of [['Version',`${info.versionName} (${info.versionCode})`],['Application',info.packageId],['Build',info.sourceCommit]]){const row=document.createElement('p'),name=document.createElement('strong');name.textContent=label+': ';row.append(name,document.createTextNode(String(value)));section.append(row);}
  (document.querySelector('main')||document.body).append(section);
 }).catch(()=>{});
 // The app keeps the server's cookie/session policy; backgrounding never starts another login or browser.
})();
