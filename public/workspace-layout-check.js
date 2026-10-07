(() => {
 'use strict';
 if(document.body.dataset.vvLayoutCheck==='frame'){
  // A diagnostic frame must leave its frame when opening normal DENY-protected routes.
  document.querySelectorAll('#primarySidebar a[href]').forEach(link=>link.target='_top');
  window.addEventListener('message',event=>{
   if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='voxel-layout-focus')return;
   const targets={top:'.main',charts:'#rfqChart',payables:'.supplier-payables-shell',accounts:'.fm-account-cat-chart'};
   const target=event.data.focus==='end'?document.querySelector('.main')?.lastElementChild:document.querySelector(targets[event.data.focus]||'.main');
   target?.scrollIntoView({block:'start'});
  });return;
 }
 const frame=document.getElementById('qaFrame');if(!frame)return;
 const stage=document.getElementById('qaStage'),width=document.getElementById('qaWidth'),height=document.getElementById('qaHeight'),scale=document.getElementById('qaScale'),module=document.getElementById('qaModule'),focus=document.getElementById('qaFocus'),theme=document.getElementById('qaTheme');
 let rotated=false;
 const focusApp=()=>frame.contentWindow?.postMessage({type:'voxel-layout-focus',focus:focus.value},location.origin);
 function resize(){
  const w=rotated?Number(height.value):Number(width.value),h=rotated?Number(width.value):Number(height.value);
  stage.style.setProperty('--qa-width',w+'px');stage.style.setProperty('--qa-height',h+'px');stage.style.setProperty('--qa-scale',scale.value);
  document.getElementById('qaStatus').textContent=`Deployed ${module.value} · ${w/Number(scale.value)} × ${h/Number(scale.value)} CSS px · ${Number(scale.value)*100}% layout emulation · ${theme.value} theme. Existing session, permissions and database. Not an iPhone/Safari device test.`;
 }
 width.onchange=height.onchange=scale.onchange=resize;focus.onchange=focusApp;
 module.onchange=()=>{focus.value=module.value==='finance'?'accounts':'top';frame.src=module.value==='finance'?'/internal/layout-check/finance?period=all#accounts':'/internal/layout-check/admin?view=dashboard';resize();};
 frame.onload=focusApp;
 theme.value=window.VoxelTheme.mode;theme.onchange=()=>{window.VoxelTheme.set(theme.value);resize();};
 document.getElementById('qaRotate').onclick=()=>{rotated=!rotated;resize();};
 document.getElementById('qaHidden').onclick=()=>{stage.hidden=!stage.hidden;};
 resize();
})();
