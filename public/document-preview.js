(() => {
 'use strict';let saved=null,loading=false;
 async function display(){if(!saved||loading)return;loading=true;document.getElementById('retry').hidden=true;try{const reader=await import('/pdf-reader.mjs');await reader.load(saved.bytes,saved.filename);}catch(error){document.getElementById('status').textContent=error.message;document.getElementById('status').className='error';document.getElementById('retry').hidden=false;}finally{loading=false;}}
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.opener||event.data?.type!=='VV_VERIFIED_PDF')return;const {filename,bytes}=event.data;if(!(bytes instanceof ArrayBuffer)||!/^[-A-Za-z0-9._ ]+\.pdf$/.test(filename))return;saved={filename,bytes};window.opener=null;display();});
 document.getElementById('retry').onclick=display;window.opener?.postMessage({type:'VV_PDF_VIEWER_READY'},location.origin);
 if(!window.opener)document.getElementById('status').textContent='Open a document preview from an authorised record to load its PDF.';
})();
