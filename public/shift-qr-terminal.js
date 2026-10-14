/* Complete branded image swaps and server-clock expiry. */
(() => {
  'use strict';
  window.VoxelGate=function({imageId,countdownId,statusId,detailId,siteId,endpoint,headers=()=>({})}){
    const image=document.getElementById(imageId);if(!image)return null;
    let timer,expires=0,offset=0,inflight=null,currentUrl=null,modules=0,stopped=false;
    const text=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};
    function resize(){if(!modules||!image.parentElement)return;const available=Math.min(440,image.parentElement.clientWidth);const scale=Math.floor(available/(modules+8));image.style.width=`${Math.max(1,scale)*(modules+8)}px`;image.style.height=image.style.width;}
    function tick(){const remaining=Math.max(0,Math.ceil((expires-Date.now()-offset)/1000));text(countdownId,expires?`${remaining}s`:'—');if(expires&&!remaining){image.hidden=true;text(statusId,'Code expired—reconnecting');text(detailId,'Waiting for a fresh workplace code.');}}
    async function refresh(){
      if(stopped||inflight)return inflight;
      inflight=(async()=>{
        const started=Date.now();
        try{
          const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store',headers:headers(),signal:AbortSignal.timeout(12000)}),data=await response.json();
          if(!response.ok)throw new Error(data.message||'Reconnect this gate with an authorised display link.');
          const server=Date.parse(data.server_time),expiry=Date.parse(data.expires_at);
          if(!Number.isFinite(server)||!Number.isFinite(expiry)||expiry<=server)throw new Error('The server returned an expired code.');
          const nextOffset=server-started;
          const rendered=await fetch(`/api/attendance-gate/image?data=${encodeURIComponent(data.qr_data)}`,{credentials:'same-origin',cache:'no-store',headers:headers(),signal:AbortSignal.timeout(12000)});
          if(!rendered.ok)throw new Error('Unable to load a fresh branded code.');
          const nextUrl=URL.createObjectURL(await rendered.blob()),next=new Image();
          try{next.src=nextUrl;await next.decode();if(stopped||expiry<=Date.now()+nextOffset)throw new Error('The new code expired while reconnecting.');}catch(error){URL.revokeObjectURL(nextUrl);throw error;}
          const prior=currentUrl;currentUrl=nextUrl;modules=Number(rendered.headers.get('X-QR-Modules'))||next.naturalWidth/8-8;
          image.src=nextUrl;image.hidden=false;expires=expiry;offset=nextOffset;resize();tick();if(prior)URL.revokeObjectURL(prior);
          text(statusId,'Connected');text(detailId,'');text(siteId,data.site_name||'');
          clearTimeout(timer);timer=setTimeout(refresh,Math.min(Number(data.refresh_seconds||20)*1000,Math.max(1000,expiry-Date.now()-offset-8000)));
        }catch(error){tick();text(statusId,expires&&expires>Date.now()+offset?'Reconnecting':'Code expired—reconnecting');text(detailId,error.message||'Connection interrupted.');clearTimeout(timer);timer=setTimeout(refresh,3000);}
        finally{inflight=null;}
      })();return inflight;
    }
    const interval=setInterval(tick,250);
    const resume=()=>{tick();if(!document.hidden)refresh();};
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);window.addEventListener('pageshow',resume);window.addEventListener('resize',resize);
    function stop(){stopped=true;clearTimeout(timer);clearInterval(interval);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('resize',resize);if(currentUrl)URL.revokeObjectURL(currentUrl);}
    refresh();return{refresh,stop};
  };
  if(document.getElementById('terminalQrImage')){
    const gate=window.VoxelGate({imageId:'terminalQrImage',countdownId:'terminalCountdown',statusId:'terminalStatus',detailId:'terminalTokenState',siteId:'terminalSite',endpoint:'/api/public/shift-qr'});
    document.getElementById('terminalRetry')?.addEventListener('click',()=>gate.refresh());
  }
})();
