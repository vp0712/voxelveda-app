(() => {
  'use strict';
  let stream=null,timer=null,generation=0,detecting=false,activeStatus=null;
  function stop(){generation++;clearTimeout(timer);timer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;detecting=false;}
  function cameraMessage(error){
    if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name))return 'Camera permission was denied. Allow camera access in your browser settings, then try again. No attendance was changed.';
    if(['NotFoundError','DevicesNotFoundError'].includes(error?.name))return 'No camera is available on this device. Use a device with a camera or contact your supervisor. No attendance was changed.';
    if(['NotReadableError','TrackStartError'].includes(error?.name))return 'The camera is busy or unavailable. Close other camera apps and retry. No attendance was changed.';
    return 'The camera or QR decoder is unavailable. Check camera access and your connection, then retry. No attendance was changed.';
  }
  async function start({video,onToken,onError,onStatus}){
    stop();const run=generation;activeStatus=onStatus;
    if(!navigator.mediaDevices?.getUserMedia){onError('Camera scanning is unavailable in this browser. Open the secure app in a supported browser. No attendance was changed.');return;}
    try{
      onStatus('Allow camera access to scan the current workplace QR code.');
      let opened;
      try{opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});}
      catch(error){if(['NotFoundError','OverconstrainedError'].includes(error.name))opened=await navigator.mediaDevices.getUserMedia({video:true,audio:false});else throw error;}
      if(run!==generation){opened.getTracks().forEach(track=>track.stop());return;}
      stream=opened;video.srcObject=stream;video.muted=true;video.playsInline=true;await video.play();
      let decoder,nativeFallbackTried=false;
      try{decoder=await window.getShiftQrDecoder();}
      catch(error){if(error?.code==='QR_DECODER_LOAD_FAILED')throw error;if(typeof window.jsQR!=='function')await window.loadExternalScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');if(typeof window.jsQR!=='function')throw error;decoder={type:'canvas'};}
      if(run!==generation)return;
      onStatus('Position the current workplace QR code inside the frame. Scanning does not change your attendance.');
      const scan=async()=>{
        if(run!==generation)return;
        try{
          if(!detecting&&video.readyState>=2){detecting=true;const token=await window.detectShiftQr(video,decoder);detecting=false;if(run!==generation)return;if(token){stop();await onToken(token);return;}}
        }catch(error){
          detecting=false;
          if(run===generation&&decoder.type==='native'&&!nativeFallbackTried){
            nativeFallbackTried=true;
            try{if(typeof window.jsQR!=='function')await window.loadExternalScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');if(typeof window.jsQR!=='function')throw error;decoder={type:'canvas'};if(run!==generation)return;timer=setTimeout(scan,100);return;}catch(fallbackError){error=fallbackError;}
          }
          if(run===generation){stop();onError(cameraMessage(error));}return;
        }
        timer=setTimeout(scan,400);
      };scan();
    }catch(error){if(run===generation){stop();onError(cameraMessage(error));}}
  }
  window.VoxelAttendanceScanner={start,stop};
  window.addEventListener('pagehide',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(stream)activeStatus?.('Camera paused while the app was in the background. Select Retry camera to resume. No attendance was changed.');stop();}});
})();
