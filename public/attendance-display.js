(() => {
 'use strict';
 const image=document.getElementById('displayQr'),message=document.getElementById('displayMessage'),status=document.getElementById('displayStatus'),expiry=document.getElementById('displayExpiry'),retry=document.getElementById('displayRetry'),stage=document.getElementById('displayStage');
 const credential=new URLSearchParams(location.hash.slice(1)).get('display')||'';
 let currentUrl=null,modules=0,anchor=null,expires=0,inflight=null,refreshTimer=null,stopped=false,unavailable=false;
 const appearance=()=>document.documentElement.dataset.colorMode=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';appearance();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',appearance);
 function resize(){if(!modules)return;const unit=Math.max(1,Math.floor(Math.min(stage.clientWidth,stage.clientHeight,1200)/(modules+8)));image.style.width=image.style.height=`${unit*(modules+8)}px`;}
 function remaining(){if(!anchor)return 0;return Math.max(0,expires-anchor.server-Math.max(performance.now()-anchor.mono,Date.now()-anchor.wall));}
 function hide(text){image.hidden=true;message.hidden=false;message.textContent=text;expiry.textContent='';}
 function tick(){if(!anchor||unavailable)return;const left=remaining();if(left<=0){hide('Code expired—reconnecting');status.textContent='Code expired—reconnecting';}else expiry.textContent=`Code expires in ${Math.ceil(left/1000)}s`;}
 async function refresh(){
  if(stopped||unavailable||inflight)return inflight;
  if(!/^vvd1_[A-Za-z0-9_-]{43}$/.test(credential)){unavailable=true;status.textContent='Display unavailable';hide('Open a valid attendance display link supplied by an authorised administrator.');return;}
  inflight=(async()=>{let nextUrl;
   try{
    const started=performance.now(),response=await fetch('/attendance-display/current',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer '+credential,Accept:'application/json'},signal:AbortSignal.timeout(12000)}),data=await response.json();
    if(!response.ok){if([401,403,404].includes(response.status)){unavailable=true;status.textContent='Display unavailable';hide(data.message||'This display link is unavailable. Ask an authorised administrator for a replacement.');retry.hidden=true;return;}throw new Error('Connection interrupted');}
    const server=Date.parse(data.server_time),end=Date.parse(data.expires_at);if(!Number.isFinite(server)||!Number.isFinite(end)||end<=server||!Number.isInteger(data.modules)||data.modules<21)throw new Error('Invalid display response');
    const bytes=Uint8Array.from(atob(data.image_png_base64),n=>n.charCodeAt(0));nextUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));const next=new Image();next.src=nextUrl;await next.decode();
    if(stopped||end-server<=performance.now()-started)throw new Error('Expired replacement');
    const prior=currentUrl;currentUrl=nextUrl;nextUrl=null;modules=data.modules;expires=end;anchor={server,mono:started,wall:Date.now()-(performance.now()-started)};
    image.src=currentUrl;resize();image.hidden=false;message.hidden=true;status.textContent='Connected';document.getElementById('displayWorkplace').textContent=data.site_name||'Voxel Veda Attendance';retry.hidden=true;tick();if(prior)URL.revokeObjectURL(prior);
    clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,Math.min(Math.max(5,Math.min(25,Number(data.refresh_seconds)||20))*1000,Math.max(1000,remaining()-8000)));
   }catch{tick();status.textContent=remaining()>0?'Reconnecting':'Code expired—reconnecting';if(!currentUrl||remaining()<=0)hide('Code expired—reconnecting');retry.hidden=false;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,3000);}
   finally{if(nextUrl)URL.revokeObjectURL(nextUrl);inflight=null;}
  })();return inflight;
 }
 const interval=setInterval(tick,250);
 function resume(){if(document.hidden)return;tick();if(anchor&&Math.abs(Date.now()-anchor.wall-(performance.now()-anchor.mono))>2500){hide('Reconnecting to confirm the current code…');anchor=null;}void refresh();}
 retry.addEventListener('click',refresh);window.addEventListener('resize',resize);window.addEventListener('online',resume);window.addEventListener('pageshow',()=>{stopped=false;resume();});document.addEventListener('visibilitychange',resume);
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(refreshTimer);});window.addEventListener('unload',()=>{clearInterval(interval);if(currentUrl)URL.revokeObjectURL(currentUrl);});
 void refresh();
})();
