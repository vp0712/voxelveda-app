(() => {
  'use strict';
  // Independent submissions are allowed; an identical write waits on its original response.
  // Failed writes are never automatically repeated because they may already have been saved.
  const originalFetch = window.fetch.bind(window);
  const inFlight = new Map();
  const account = () => { try { return String(JSON.parse(localStorage.getItem('user') || '{}').id || '') + '|' + (localStorage.getItem('token') || ''); } catch { return ''; } };
  window.fetch = async (input, options = {}) => {
    const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const owner=account(),current=()=>owner===account();
    const requestUrl=input instanceof Request?input.url:String(input);
    const key = typeof options.body === 'string' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? owner + ' ' + method + ' ' + requestUrl + ' ' + options.body : null;
    if (key && inFlight.has(key)) return (await inFlight.get(key)).clone();
    const request = originalFetch(input, options).then(async response=>{
      if(current()&&['POST','PUT','PATCH','DELETE'].includes(method)&&response.status>=500)window.VoxelDialog?.markUncertain?.();
      if(!['POST','PUT','PATCH','DELETE'].includes(method)||!response.ok||response.status===204)return response;
      const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(type==='application/pdf')return response;
      const validJson=type==='application/json'&&await response.clone().json().then(value=>value!==null&&typeof value==='object').catch(()=>false);
      if(validJson)return response;
      if(current())window.VoxelDialog?.markUncertain?.();
      return new Response(JSON.stringify({message:'The action response could not be confirmed. Refresh the record before retrying.',code:'ACTION_RESPONSE_UNCERTAIN'}),{status:502,headers:{'Content-Type':'application/json'}});
    }).catch(error=>{if(current()&&['POST','PUT','PATCH','DELETE'].includes(method))window.VoxelDialog?.markUncertain?.();throw error;});
    if (key) inFlight.set(key, request);
    try {
      const response = await request;
      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.clone().json().catch(() => null);
        if (current() && (data?.errors || data?.fields || data?.field_errors || data?.validation_errors)) showFieldErrors(data.errors || data.fields || data.field_errors || data.validation_errors);
      }
      return response;
    } finally { if (key) inFlight.delete(key); }
  };
  function showFieldErrors(errors) {
    const activeDialog = document.querySelector('.dialog-backdrop.active');
    const root = activeDialog || document.querySelector('.page-section:not(.hidden-section)') || document;
    const entries = Array.isArray(errors)
      ? errors.map(error => [error.field || error.path || error.param, error.message || error.msg])
      : Object.entries(errors || {});
    for (const [name, message] of entries) {
      if (!name || !message) continue;
      const field = [...root.querySelectorAll('input,select,textarea')].find(item => item.name === name || item.id === name || item.id.toLowerCase().endsWith(String(name).replaceAll('_', '').toLowerCase()));
      if (!field) continue;
      field.setAttribute('aria-invalid', 'true');
      const id = (field.id || 'field-' + name) + '-error';
      let label = document.getElementById(id);
      if (!label) { label = document.createElement('span'); label.id = id; label.className = 'field-error'; field.after(label); }
      label.textContent = Array.isArray(message) ? message.join(' ') : String(message);
      field.setAttribute('aria-describedby', id);
    }
    root.querySelector('[aria-invalid="true"]')?.focus();
  }
  function bindActions(root = document) {
    root.querySelectorAll('form').forEach(form=>{
      if(form.dataset.vvValidationBound)return;form.dataset.vvValidationBound='true';form.noValidate=true;
      form.addEventListener('submit',event=>{if(window.VoxelDialog&&!window.VoxelDialog.validate(form)){event.preventDefault();event.stopImmediatePropagation();}},true);
    });
    root.querySelectorAll('button[onclick]').forEach(button => {
      if (button.dataset.actionBound || !button.onclick || /dialogPrimaryBtn/i.test(button.id)) return;
      button.dataset.actionBound = 'true';
      const action = button.onclick;
      button.onclick = async event => {
        if (button.disabled) return;
        const result = action.call(button, event);
        if (!result || typeof result.then !== 'function') return result;
        button.disabled = true; button.setAttribute('aria-busy', 'true');
        try { return await result; }
        catch (error) { window.VoxelFeedback?.notify(error.message || 'The action failed. Review the record before retrying.', {kind:'error'}); }
        finally { button.disabled = false; button.removeAttribute('aria-busy'); }
      };
    });
    // Preserve existing controls while giving placeholder-only legacy fields accessible names.
    root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(field => {
      if (!field.getAttribute('aria-label') && !field.labels?.length) field.setAttribute('aria-label', field.placeholder);
    });
  }
  document.addEventListener('input', event => {
    if (!event.target.matches('input,textarea,select')) return;
    const field = event.target;
    field.setCustomValidity?.('');
    if (field.getAttribute('aria-invalid') === 'true') {
      field.removeAttribute('aria-invalid');
      const label = document.getElementById(field.getAttribute('aria-describedby'));
      if (label?.classList.contains('field-error')||label?.classList.contains('vv-validation-error')) label.remove();
      field.removeAttribute('aria-describedby');
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    bindActions();
    new MutationObserver(mutations => { if (mutations.some(mutation => mutation.addedNodes.length)) bindActions(); }).observe(document.body, { childList:true, subtree:true });
    const sidebar = document.getElementById('primarySidebar');
    if (!sidebar) return;
    let returnFocus = null;
    new MutationObserver(() => {
      const open = sidebar.classList.contains('is-open');
      if (open && !returnFocus) returnFocus = document.activeElement;
      sidebar.inert = matchMedia('(max-width:1023px)').matches && !open;
      if (!open && returnFocus) { returnFocus.focus?.({ preventScroll:true }); returnFocus = null; }
    }).observe(sidebar, { attributes:true, attributeFilter:['class','aria-hidden'] });
    sidebar.inert = matchMedia('(max-width:1023px)').matches && !sidebar.classList.contains('is-open');
    document.addEventListener('keydown', event => {
      if (!sidebar.classList.contains('is-open')) return;
      if (event.key === 'Escape') { window.toggleMobileMenu?.(false); return; }
      if (event.key !== 'Tab') return;
      const controls = [...sidebar.querySelectorAll('button,a[href],input,summary')].filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  });
  async function openPdf(url, options = {}) {
    const { download = false, ...request } = options;
    const accountKey=()=>{try{return String(JSON.parse(localStorage.getItem('user')||'{}').id||'')+'|'+(localStorage.getItem('token')||'');}catch{return 'storage-unavailable';}};
    const owner=accountKey();
    const assertAccount=()=>{if(accountKey()!==owner)throw Object.assign(new Error('The signed-in account changed. Open the document again from your current account.'),{code:'PDF_ACCOUNT_CHANGED'});};
    // Open immediately for browser popup policy, then fill only after validation.
    const native=window.VoxelNativeApp;
    const preview = download || native ? null : window.open('/document/view', '_blank');
    let readyHandler,timer,objectUrl;const ready=preview?new Promise((resolve,reject)=>{readyHandler=event=>{if(event.source===preview&&event.origin===location.origin&&event.data?.type==='VV_PDF_VIEWER_READY')resolve();};window.addEventListener('message',readyHandler);timer=setTimeout(()=>reject(new Error('The preview could not be opened. Download the verified PDF instead.')),15000);}):null;ready?.catch(()=>{});
    try {
      const response = await fetch(url, { credentials:'same-origin', cache:'no-store', ...request });
      assertAccount();
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'The PDF could not be generated. No alternative file was provided.');
      }
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new Error('The service returned an invalid PDF content type.');
      const filename = (response.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/i)?.[1];
      if (!filename || !/^[A-Za-z0-9._ -]+\.pdf$/.test(filename)) throw new Error('The service returned an invalid PDF filename.');
      const bytes = await response.arrayBuffer();
      assertAccount();
      if (bytes.byteLength < 100 || new TextDecoder('ascii').decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('The service returned invalid PDF bytes.');
      if(native){await native.documentAction(bytes,filename,download);return {filename,bytes:bytes.byteLength};}
      objectUrl = URL.createObjectURL(new Blob([bytes], { type:'application/pdf' }));
      if (download) {
        const link = document.createElement('a'); link.href = objectUrl; link.download = filename;
        document.body.append(link); link.click(); link.remove();
      } else if (preview) { await ready;assertAccount();preview.postMessage({type:'VV_VERIFIED_PDF',filename,bytes},location.origin); }
      else { const link = document.createElement('a'); link.href = objectUrl; link.target = '_blank'; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove(); }
      // Keep the bytes available for the browser PDF viewer's own download control.
      window.addEventListener('pagehide', () => URL.revokeObjectURL(objectUrl), { once:true });
      return { filename, bytes:bytes.byteLength };
    } catch (error) { if (preview) preview.close();if(objectUrl)URL.revokeObjectURL(objectUrl);throw error; }finally{if(readyHandler)window.removeEventListener('message',readyHandler);clearTimeout(timer);}
  }
  window.VoxelOperations = { showFieldErrors, openPdf };
})();
