(() => {
'use strict';

const WATCHDOG_MS=26000;
let completed=false;
let watchdog=null;

function loadingNode(){
  return document.querySelector('#fmContent .fm-loading');
}

function showStartupFailure(message){
  if(completed||!loadingNode())return;
  completed=true;
  if(watchdog)clearTimeout(watchdog);
  const content=document.getElementById('fmContent');
  const notice=document.getElementById('fmNotice');
  if(notice){
    notice.hidden=false;
    notice.textContent=message||'Finance startup did not complete.';
    notice.style.background='#fde9eb';
    notice.style.color='#8f2732';
  }
  if(content){
    content.innerHTML='<div class="fm-state fm-state-error"><strong>Finance startup stopped safely</strong><p>The workspace did not finish loading, so the permanent spinner was stopped. Reload Finance to try again.</p><button type="button" data-finance-hard-retry="1">Reload Finance</button></div>';
    content.querySelector('[data-finance-hard-retry]')?.addEventListener('click',()=>location.reload());
  }
}

function armWatchdog(){
  if(completed)return;
  if(watchdog)clearTimeout(watchdog);
  watchdog=setTimeout(()=>showStartupFailure('Finance startup timed out. No request is allowed to leave this screen loading forever.'),WATCHDOG_MS);
}

window.addEventListener('finance:ready',()=>{
  completed=true;
  if(watchdog)clearTimeout(watchdog);
});
window.addEventListener('finance:fatal',()=>{
  completed=true;
  if(watchdog)clearTimeout(watchdog);
});
window.addEventListener('error',()=>{
  if(loadingNode())showStartupFailure('A Finance script failed before startup completed.');
});
window.addEventListener('unhandledrejection',()=>{
  if(loadingNode())showStartupFailure('A Finance startup task failed before the workspace rendered.');
});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',armWatchdog,{once:true});
else armWatchdog();
})();
