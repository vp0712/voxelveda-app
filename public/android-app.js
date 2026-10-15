(() => {
 'use strict';
 const platform=window.Capacitor;
 const plugin=platform?.Plugins?.VoxelVedaApp;
 if(!platform?.isNativePlatform?.()||!plugin)return;
 const canonical='https://app.voxelveda.com';
 if(location.origin!==canonical)return;
 const base64=bytes=>{const input=new Uint8Array(bytes);let value='';for(let n=0;n<input.length;n+=16384)value+=String.fromCharCode(...input.subarray(n,n+16384));return btoa(value);};
 async function documentAction(bytes,filename,download=false){
  if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}\.pdf$/.test(filename)||bytes.byteLength<100||new TextDecoder('ascii').decode(bytes.slice(0,5))!=='%PDF-')throw new Error('The document is not a valid PDF. No file was saved.');
  const data={filename,base64:base64(bytes)};
  return download?plugin.savePdf(data):plugin.presentPdf(data);
 }
 function handleBack(){
  const security=document.getElementById('stepUpDialog');
  if(security&&!security.hidden){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}
  if(window.VoxelOverlay?.active){window.VoxelOverlay.closeAll();return true;}
  const menu=document.querySelector('.record-action-menu[open]');if(menu){menu.open=false;return true;}
  if(document.body.classList.contains('mobile-menu-open')){window.toggleMobileMenu?.(false);window.toggleStaffMobileMenu?.(false);return true;}
  const dirty=document.querySelector('form[data-native-dirty="true"]');
  if(dirty&&!window.confirm('Discard your unsaved changes?'))return true;
  return false;
 }
 window.VoxelNativeApp={handleBack,documentAction,openCameraSettings:()=>plugin.openCameraSettings()};
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
