import * as pdfjs from '/vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
let documentPdf=null,bytesUrl=null,pageNumber=1,zoom=1,renderTask=null,version=0,resizeTimer;
const $=id=>document.getElementById(id);
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
async function render(){
 if(!documentPdf)return;const generation=++version;renderTask?.cancel();
 try{const page=await documentPdf.getPage(pageNumber);if(generation!==version)return;const base=page.getViewport({scale:1}),available=Math.max(140,$('pdfStage').clientWidth-24),scale=available/base.width*zoom,viewport=page.getViewport({scale}),ratio=Math.min(devicePixelRatio||1,2),canvas=$('preview');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=Math.ceil(viewport.width)+'px';canvas.style.height=Math.ceil(viewport.height)+'px';renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});await renderTask.promise;if(generation!==version)return;canvas.hidden=false;$('pdfPage').textContent=`Page ${pageNumber} of ${documentPdf.numPages}`;$('pdfPrevious').disabled=pageNumber<=1;$('pdfNext').disabled=pageNumber>=documentPdf.numPages;$('pdfZoom').textContent=Math.round(zoom*100)+'%';$('pdfZoomOut').disabled=zoom<=.5;$('pdfZoomIn').disabled=zoom>=3;}
 catch(error){if(error.name==='RenderingCancelledException')return;status('This page could not be displayed. Retry loading the PDF or download the original.',true);$('retry').hidden=false;}
}
export async function load(bytes,filename){
 if(bytes.byteLength<100||new TextDecoder('ascii').decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Invalid PDF bytes. No file was downloaded.');
 renderTask?.cancel();version++;documentPdf?.destroy();pageNumber=1;zoom=1;
 documentPdf=await pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),isEvalSupported:false,enableXfa:false,standardFontDataUrl:'/vendor/pdf-fonts/'}).promise;
 if(!documentPdf.numPages)throw new Error('The PDF has no readable pages.');
 const sourceSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(bytesUrl)URL.revokeObjectURL(bytesUrl);bytesUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('pdfNative').href=bytesUrl;if(window.VoxelNativeApp)$('pdfNative').onclick=event=>{event.preventDefault();window.VoxelNativeApp.documentAction(bytes,filename,false).catch(error=>status(error.message,true));};$('pdfNative').hidden=false;$('download').disabled=false;$('download').onclick=()=>{if(window.VoxelNativeApp)return window.VoxelNativeApp.documentAction(bytes,filename,true).catch(error=>status(error.message,true));const link=document.createElement('a');link.href=bytesUrl;link.download=filename;document.body.append(link);link.click();link.remove();};window.VoxelPdfReader={url:bytesUrl,filename,pageCount:documentPdf.numPages,sourceSha256};$('pdfControls').hidden=false;status(`${filename} · verified PDF. Preview and download use the same bytes.`);await render();
 window.VoxelPdfReader={url:bytesUrl,filename,pageCount:documentPdf.numPages,sourceSha256};
}
$('pdfPrevious').onclick=()=>{pageNumber=Math.max(1,pageNumber-1);render();};$('pdfNext').onclick=()=>{pageNumber=Math.min(documentPdf?.numPages||1,pageNumber+1);render();};$('pdfZoomIn').onclick=()=>{zoom=Math.min(3,zoom+.25);render();};$('pdfZoomOut').onclick=()=>{zoom=Math.max(.5,zoom-.25);render();};$('pdfFit').onclick=()=>{zoom=1;render();};
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(render,150);});window.addEventListener('pagehide',()=>{renderTask?.cancel();documentPdf?.destroy();if(bytesUrl)URL.revokeObjectURL(bytesUrl);});
