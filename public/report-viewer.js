(() => {
  'use strict';
  const feedback=document.getElementById('vrFeedback');
  const tell=(message,bad=false)=>{if(feedback){feedback.textContent=message;feedback.setAttribute('role',bad?'alert':'status');}};
  async function request(url,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch(url,{credentials:'same-origin',...options,signal:controller.signal});
      if(response.status===401||response.redirected&&new URL(response.url).pathname==='/login'){
        location.assign('/login?returnTo='+encodeURIComponent(location.pathname+location.search));
        throw new Error('Your session ended. Sign in to return to this saved report.');
      }
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'The report action failed. Please retry.');}
      return response;
    }catch(error){if(error.name==='AbortError')throw new Error('This action timed out. The saved report remains available. Please retry.');throw error;}
    finally{clearTimeout(timer);}
  }
  function save(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  document.querySelectorAll('[data-report-download]').forEach(link=>link.addEventListener('click',async event=>{
    event.preventDefault();if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');tell('Preparing the saved report download…');
    try{
      const response=await request(link.href),type=response.headers.get('Content-Type')||'';
      const filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
      const format=new URL(link.href).pathname.split('/').pop();
      const types={html:'text/html',csv:'text/csv',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
      if(!filename||!type.startsWith(types[format]||'INVALID'))throw new Error('The server did not return the requested report format.');
      const blob=await response.blob();if(!blob.size)throw new Error('The report file is empty.');
      save(blob,filename);tell(format.toUpperCase()+' download ready. All rows come from this saved snapshot.');
    }catch(error){tell(error.message,true);}finally{link.removeAttribute('aria-busy');}
  }));
  document.querySelector('[data-report-print]')?.addEventListener('click',async event=>{
    const button=event.currentTarget;if(button.disabled)return;
    const target=window.open('about:blank','_blank');
    button.disabled=true;tell('Preparing every report page for print…');
    try{
      const response=await request(button.dataset.reportPrint),blob=await response.blob(),url=URL.createObjectURL(blob);
      if(target){target.location.href=url;target.onload=()=>{try{target.focus();target.print();}catch{tell('Print view opened. Use your browser’s Print / Save as PDF command.');}};tell('Full report opened for print.');}
      else{save(blob,response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'Voxel-Veda-Print-Report.html');tell('The browser blocked a new window. The full print-friendly HTML was downloaded; open it and use Print / Save as PDF.');}
      setTimeout(()=>URL.revokeObjectURL(url),120000);
    }catch(error){target?.close();tell(error.message,true);}finally{button.disabled=false;}
  });
  document.querySelector('[data-report-email]')?.addEventListener('click',event=>{
    let dialog=document.querySelector('.vr-email-dialog');if(dialog){dialog.showModal();return;}
    dialog=document.createElement('dialog');dialog.className='vr-email-dialog';
    dialog.innerHTML='<form><h2>Email saved report</h2><p>The email includes a View report link. Opening it requires the authorised Voxel Veda account. A PDF is attached only if generation and parsing succeed.</p><label>Recipient email<input name="to" type="email" required autocomplete="email"></label><label>Note<textarea name="note" maxlength="500"></textarea></label><p data-email-status role="status"></p><div class="vr-actions"><button type="button" data-cancel>Cancel</button><button type="submit">Send report</button></div></form>';
    document.body.appendChild(dialog);dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    const reportId=event.currentTarget.dataset.reportEmail;
    dialog.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type="submit"]'),status=form.querySelector('[data-email-status]');
      button.disabled=true;status.textContent='Preparing report delivery…';
      try{const data=new FormData(form),response=await request('/api/finance/reports/builder/email-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report_id:reportId,to:data.get('to'),note:data.get('note')})});
        const result=await response.json();dialog.close();tell(result.message+' PDF: '+result.pdf_status+'.');}
      catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    };dialog.showModal();
  });
})();
