(function () {
  'use strict';
  if (window.VoxelAvatar) return;
  const bindings = new Map(), photos = new Map();
  let profile = null, generation = 0, pendingProfile = null, lastRefresh = 0;
  let identity = fingerprint();
  let profileController = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vv-profile-avatar') : null;
  function storedUser() { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } }
  function fingerprint() { return String(localStorage.getItem('token') || '') + ':' + String(storedUser().id || ''); }
  function initials(name) { return String(name || 'VV').trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]?.toUpperCase() || '').join('') || 'VV'; }
  function headers() {
    const token = String(localStorage.getItem('token') || '').trim();
    return {Accept:'application/json',...(token && !['null','undefined'].includes(token) ? {Authorization:`Bearer ${token}`} : {})};
  }
  function styles() {
    if (document.getElementById('vvSharedAvatarStyle')) return;
    const style = document.createElement('style'); style.id = 'vvSharedAvatarStyle';
    style.textContent = '.vv-avatar-photo{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}.vv-avatar-initials{display:grid;place-items:center;max-width:100%;max-height:100%;color:inherit}.vv-avatar-loading{opacity:.7}.vv-avatar-has-photo{overflow:hidden}.vv-avatar-has-photo .vv-avatar-initials{display:none}.vv-avatar-photo[hidden],.vv-avatar-initials[hidden]{display:none!important}';
    document.head.appendChild(style);
  }
  function notify(binding, state, message) {
    binding.state = state;binding.target.dataset.avatarState = state;
    binding.target.classList.toggle('vv-avatar-loading',state === 'loading');
    binding.target.setAttribute('aria-busy',state === 'loading' ? 'true' : 'false');
    if(state==='loaded'||state==='missing'){binding.target.title=binding.defaultTitle||'';binding.failureTitle=null;}
    if(state==='loading' && !binding.url && binding.fallback.textContent!=='…')binding.fallback.textContent='…';
    binding.onState?.({state,message,userId:binding.userId});
  }
  function fallback(binding, state = 'missing', message = '') {
    binding.image.removeAttribute('src'); binding.image.hidden = true; binding.image.style.display = 'none';
    const label=initials(binding.name);if(binding.fallback.textContent!==label)binding.fallback.textContent=label;binding.fallback.hidden = false; binding.fallback.style.display = '';
    binding.target.classList.remove('vv-avatar-has-photo');binding.url = null;
    if (state === 'failed'){binding.failureTitle=message || 'Photo could not be loaded. Open My Profile and retry.';binding.target.title=binding.failureTitle;}
    notify(binding,state,message);
  }
  function clear() {
    generation++; pendingProfile = null; profile = null; lastRefresh = 0;
    profileController?.abort();profileController=null;
    for (const photo of photos.values()) { photo.controller?.abort(); if(photo.url) URL.revokeObjectURL(photo.url); }
    photos.clear();
    for (const binding of bindings.values()) { binding.name = binding.self ? '' : binding.name; fallback(binding,'missing'); }
    window.dispatchEvent(new CustomEvent('vv:avatar-clear'));
  }
  function checkIdentity() { const next=fingerprint(); if(next!==identity){clear();identity=next;} return identity; }
  function validUrl(value, userId, self) {
    const url = new URL(value,location.origin),expected = self ? '/api/profile/photo' : `/api/profile/staff/${userId}/photo`;
    if(url.origin!==location.origin || url.pathname!==expected || url.username || url.password || [...url.searchParams.keys()].some(key=>key!=='v')) throw new Error('The profile photo reference is invalid.');
    return url.pathname + url.search;
  }
  async function fetchPhoto(binding, reference, revision) {
    const expectedIdentity=checkIdentity(), expectedGeneration=generation;
    const cacheKey=`${expectedGeneration}:${binding.userId}:${revision || reference}`;
    binding.cacheKey=cacheKey;
    let cached=photos.get(cacheKey);
    if(!cached){
      const controller=new AbortController();cached={controller,userId:binding.userId,url:null,promise:null,state:'pending',error:null};photos.set(cacheKey,cached);
      const timer=setTimeout(()=>controller.abort(),8000);
      cached.promise=(async()=>{
        const response=await fetch(validUrl(reference,binding.userId,binding.self),{credentials:'same-origin',cache:'no-store',headers:{...headers(),Accept:'image/jpeg,image/png,image/webp'},signal:controller.signal});
        if(response.status===401){if(expectedGeneration===generation && expectedIdentity===checkIdentity()){clear();window.dispatchEvent(new CustomEvent('vv:avatar-auth-required'));}throw new Error('Sign in again to load your profile photo.');}
        if(response.status===404){if(binding.self)throw new Error('Your saved photo is unavailable. Retry loading it or upload a new photo.');cached.state='missing';return null;}
        if(!response.ok)throw new Error('Photo could not be loaded. Retry from My Profile.');
        const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
        if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('The photo service returned an unsupported image.');
        const blob=await response.blob();if(!blob.size||blob.size>5*1024*1024)throw new Error('The profile photo is empty or too large.');
        if(expectedGeneration!==generation || expectedIdentity!==checkIdentity() || photos.get(cacheKey)!==cached)return null;
        cached.url=URL.createObjectURL(blob);cached.state='ready';return cached.url;
      })().catch(error=>{cached.state='failed';cached.error=error;throw error;}).finally(()=>clearTimeout(timer));
    }
    if(cached.state==='missing'){fallback(binding,'missing');return;}
    if(cached.state==='failed'){fallback(binding,'failed',cached.error?.name==='AbortError'?'Photo loading timed out. Retry from My Profile.':cached.error?.message);return;}
    if(cached.url && binding.url===cached.url && binding.state==='loaded')return;
    notify(binding,'loading');
    try{
      const url=await cached.promise;
      if(expectedGeneration!==generation || expectedIdentity!==checkIdentity() || bindings.get(binding.target)!==binding)return;
      if(!url){fallback(binding,'missing');return;}
      if(binding.url===url && binding.state==='loaded')return;
      binding.url=url;
      binding.image.onload=()=>{
        if(binding.url!==url || expectedGeneration!==generation)return;
        binding.image.hidden=false;binding.image.style.display='block';binding.fallback.hidden=true;binding.fallback.style.display='none';binding.target.classList.add('vv-avatar-has-photo');notify(binding,'loaded');
      };
      binding.image.onerror=()=>{if(binding.url===url){cached.state='failed';cached.error=new Error('This photo could not be displayed. Retry from My Profile.');fallback(binding,'failed',cached.error.message);}};
      binding.image.src=url;
    }catch(error){if(expectedGeneration===generation && bindings.get(binding.target)===binding)fallback(binding,'failed',error.name==='AbortError'?'Photo loading timed out. Retry from My Profile.':error.message);}
  }
  function render(binding) {
    if(binding.self){
      if(!profile){binding.name='';fallback(binding,'missing');return;}
      binding.userId=Number(profile.id);binding.name=profile.name || profile.username || '';const label=initials(binding.name);if(binding.state!=='loading' && binding.fallback.textContent!==label)binding.fallback.textContent=label;
      if(!profile.has_profile_photo || !profile.profile_photo_url){fallback(binding,'missing');return;}
      fetchPhoto(binding,profile.profile_photo_url,profile.profile_photo_revision || profile.profile_photo_updated_at);
    }else {
      if(!Number.isSafeInteger(binding.userId)||binding.userId<1){fallback(binding,'missing');return;}
      fetchPhoto(binding,`/api/profile/staff/${binding.userId}/photo${binding.revision?'?v='+encodeURIComponent(binding.revision):''}`,binding.revision);
    }
  }
  function mount(target, options={}) {
    if(!target)return null;styles();checkIdentity();let binding=bindings.get(target);
    if(binding && target.contains(binding.image) && target.contains(binding.fallback)){if(target.title!==binding.failureTitle)binding.defaultTitle=target.title||'';Object.assign(binding,options);render(binding);return binding;}
    const image=options.image || document.createElement('img'),initial=options.fallback || document.createElement('span');
    image.classList.add('vv-avatar-photo');image.alt='';image.decoding='async';image.hidden=true;initial.classList.add('vv-avatar-initials');
    if(!options.image)target.replaceChildren(image,initial);
    const self=options.self!==false;
    binding={target,image,fallback:initial,self,userId:self?Number(options.userId||profile?.id||0):Number(options.userId),name:options.name||'',revision:options.revision||null,onState:options.onState,url:null,cacheKey:null,defaultTitle:binding?.defaultTitle||target.title||'',failureTitle:null,state:'missing'};
    bindings.set(target,binding);render(binding);return binding;
  }
  function mountAll() {
    for(const target of document.querySelectorAll('[data-avatar-self], [data-avatar-user-id], #profileInitial'))mount(target,{self:!target.hasAttribute('data-avatar-user-id'),userId:Number(target.dataset.avatarUserId||0),name:target.dataset.avatarName||''});
    for(const [target] of bindings)if(!target.isConnected)bindings.delete(target);
    // Directory paging removes targets. Keep only cache entries referenced by
    // live bindings, including a shared header/profile photo and cached 404s.
    const liveKeys=new Set([...bindings.values()].map(binding=>binding.cacheKey).filter(Boolean));
    for(const [key,value] of photos)if(!liveKeys.has(key)){value.controller?.abort();if(value.url)URL.revokeObjectURL(value.url);photos.delete(key);}
  }
  function updateSelf(next,{broadcast=true}={}) {
    checkIdentity();if(!next || !Number.isSafeInteger(Number(next.id)) || Number(next.id)<1){clear();return;}
    const previous=profile;if(previous && Number(previous.id)!==Number(next.id))clear();
    const changed=previous && (previous.profile_photo_revision!==next.profile_photo_revision || previous.profile_photo_updated_at!==next.profile_photo_updated_at || previous.has_profile_photo!==next.has_profile_photo);
    if(changed){generation++;pendingProfile=null;for(const value of photos.values()){value.controller?.abort();if(value.url)URL.revokeObjectURL(value.url);}photos.clear();for(const binding of bindings.values())fallback(binding,'missing');}
    profile={...next};mountAll();for(const binding of bindings.values())render(binding);
    window.dispatchEvent(new CustomEvent('vv:avatar-profile',{detail:{profile:{...profile}}}));
    if(broadcast)channel?.postMessage({type:'profile-changed',userId:Number(profile.id),revision:profile.profile_photo_revision||profile.profile_photo_updated_at||null});
  }
  async function refreshSelf({force=false}={}) {
    const expectedIdentity=checkIdentity();mountAll();if(pendingProfile)return pendingProfile;
    if(!force && profile && Date.now()-lastRefresh<15000)return profile;
    const expectedGeneration=generation,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    profileController=controller;
    pendingProfile=(async()=>{
      const response=await fetch('/api/profile',{credentials:'same-origin',cache:'no-store',headers:headers(),signal:controller.signal});
      if(response.status===401){if(expectedGeneration===generation && expectedIdentity===checkIdentity()){clear();window.dispatchEvent(new CustomEvent('vv:avatar-auth-required'));}return null;}
      if(!response.ok)throw new Error('Profile could not be loaded. Retry from My Profile.');
      const data=await response.json();if(expectedGeneration!==generation || expectedIdentity!==checkIdentity())return null;
      updateSelf(data.profile,{broadcast:false});lastRefresh=Date.now();return profile;
    })().catch(error=>{if(expectedGeneration===generation)for(const binding of bindings.values())if(binding.self)fallback(binding,'failed',error.name==='AbortError'?'Profile loading timed out. Retry from My Profile.':error.message);return null;})
      .finally(()=>{clearTimeout(timer);if(profileController===controller){profileController=null;pendingProfile=null;}});
    return pendingProfile;
  }
  function retrySelf(){for(const value of photos.values()){value.controller?.abort();if(value.url)URL.revokeObjectURL(value.url);}photos.clear();for(const binding of bindings.values())fallback(binding,'missing');return refreshSelf({force:true});}
  window.VoxelAvatar={mount,mountAll,refreshSelf,updateSelf,clear,retrySelf,initials,objectUrl:target=>bindings.get(target)?.url||null,authHeaders:headers};
  function start(){mountAll();refreshSelf();new MutationObserver(()=>mountAll()).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('storage',event=>{if(!event.key || ['token','user'].includes(event.key)){checkIdentity();refreshSelf({force:true});}});
  window.addEventListener('vv:auth-changed',()=>{clear();identity=fingerprint();refreshSelf({force:true});});
  window.addEventListener('vv:profile-photo-updated',()=>refreshSelf({force:true}));
  window.addEventListener('pageshow',()=>refreshSelf({force:true}));window.addEventListener('focus',()=>refreshSelf());window.addEventListener('pagehide',()=>clear());
  channel?.addEventListener('message',event=>{
    if(event.data?.type!=='profile-changed')return;
    const userId=Number(event.data.userId);if(!Number.isSafeInteger(userId)||userId<1)return;
    if(userId===Number(profile?.id)){refreshSelf({force:true});return;}
    for(const [key,value] of photos)if(value.userId===userId){value.controller?.abort();if(value.url)URL.revokeObjectURL(value.url);photos.delete(key);}
    for(const binding of bindings.values())if(!binding.self && binding.userId===userId){fallback(binding,'loading');render(binding);}
  });
})();
