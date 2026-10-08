(() => {
  'use strict';
  const feedback=document.getElementById('vrFeedback');
  const tell=(message,bad=false)=>{if(feedback){feedback.textContent=message;feedback.setAttribute('role',bad?'alert':'status');}};
  async function request(url,options={},consume=response=>response){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch(url,{credentials:'same-origin',...options,signal:controller.signal});
      if(response.status===401||response.redirected&&new URL(response.url).pathname==='/login'){
        location.assign('/login?returnTo='+encodeURIComponent(location.pathname+location.search+location.hash));
        throw new Error('Your session ended. Sign in to return to this saved report.');
      }
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'The report action failed. Please retry.');}
      // The deadline also covers a stalled attachment body, not just headers.
      return await consume(response);
    }catch(error){if(error.name==='AbortError')throw new Error('This action timed out. The saved report remains available. Please retry.');throw error;}
    finally{clearTimeout(timer);}
  }
  function save(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function reportFile(response,format){
    const type=String(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    const filename=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
    const types={print:'text/html',html:'text/html',csv:'text/csv',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    if(!filename||type!==types[format])throw new Error('The server did not return the requested report format.');
    const blob=await response.blob();if(!blob.size)throw new Error('The report file is empty.');
    if(format==='pdf'&&(await blob.slice(0,5).text())!=='%PDF-')throw new Error('The PDF response is invalid. The saved report remains available online.');
    return {blob,filename};
  }
  document.querySelectorAll('[data-report-download]').forEach(link=>link.addEventListener('click',async event=>{
    event.preventDefault();if(link.getAttribute('aria-busy')==='true')return;link.setAttribute('aria-busy','true');tell('Preparing the saved report download…');
    try{
      // Keep the same-origin API path so the shared step-up fetch wrapper can
      // recognise the protected request and resume it after verification.
      const format=new URL(link.href).pathname.split('/').pop();
      const {blob,filename}=await request(link.getAttribute('href'),{},response=>reportFile(response,format));
      save(blob,filename);tell(format.toUpperCase()+' download ready. All rows come from this saved snapshot.');
    }catch(error){tell(error.message,true);}finally{link.removeAttribute('aria-busy');}
  }));
  document.querySelector('[data-report-print]')?.addEventListener('click',async event=>{
    const button=event.currentTarget;if(button.disabled)return;
    let target=null;try{target=window.open('about:blank','_blank');}catch{}
    if(target)target.document.body.textContent='Preparing the complete saved report for printing…';
    button.disabled=true;tell('Preparing every report page for print…');
    try{
      const {blob,filename}=await request(button.dataset.reportPrint,{},response=>reportFile(response,'print'));
      if(target&&!target.closed){
        const url=URL.createObjectURL(blob);
        target.onload=()=>{try{target.focus();target.print();}catch{tell('Print view opened. Use your browser’s Print / Save as PDF command.');}};
        target.location.href=url;tell('Full report opened for print.');setTimeout(()=>URL.revokeObjectURL(url),120000);
      }else{save(blob,filename);tell('A print window is unavailable. The full print-friendly HTML was downloaded; open it and use Print / Save as PDF.');}
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
      button.disabled=true;status.setAttribute('role','status');status.textContent='Preparing report delivery…';
      try{const data=new FormData(form),result=await request('/api/finance/reports/builder/email-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report_id:reportId,to:data.get('to'),note:data.get('note')})},response=>response.json());
        dialog.close();tell((result.message||'Email outcome received.')+' PDF: '+result.pdf_status+'. Email: '+(result.email_outcome?.status||'Outcome unknown')+'.');}
      catch(error){status.setAttribute('role','alert');status.textContent=error.message;}finally{button.disabled=false;}
    };dialog.showModal();
  });
})();
