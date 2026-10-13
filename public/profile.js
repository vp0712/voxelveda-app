let currentProfile = null;
let initialEditableState = '';
let profileSaving = false;
let photoSaving = false;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const avatarEl = $('avatar');
const initialsEl = $('initials');
const avatarWrapEl = $('avatarWrap');
const photoViewerEl = $('photoViewer');
const viewerImageEl = $('viewerImage');
const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = 1400 * 1024;

function setStatus(message = '', type = '') {
  statusEl.textContent = message;
  statusEl.className = `status${type ? ` ${type}` : ''}`;
}

function initials(name) {
  return String(name || 'VV')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'VV';
}

function profilePortal(role) {
  return '/dashboard';
}

function redirectToLogin(message = 'Please login to continue.') {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
  const params = new URLSearchParams({ message, returnTo: '/profile' });
  window.location.replace(`/login?${params.toString()}`);
}

async function readJson(response) {
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401) redirectToLogin(data.message || 'Your session expired. Please login again.');
  return data;
}

async function api(path, options = {}) {
  let response;
  const requestHeaders=window.VoxelAvatar?.authHeaders() || {};
  const storedId=()=>{try{return String(JSON.parse(localStorage.getItem('user')||'{}').id||'');}catch{return '';}};
  const requestUserId=storedId();
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...requestHeaders,
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('load failed') || message.includes('network') || message.includes('fetch')) {
      throw new Error('Connection interrupted while sending the photo. Please try again.');
    }
    throw error;
  }
  if((window.VoxelAvatar?.authHeaders().Authorization||'')!==(requestHeaders.Authorization||'') || storedId()!==requestUserId)throw new Error('Your account changed. Reload the current profile before retrying.');
  const data = await readJson(response);
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed'), { fields: data.fields || {} });
  return data;
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function editableState() {
  return JSON.stringify({ name: $('name').value.trim(), mobile_number: $('mobile').value.trim(), timesheet_delivery_email: $('timesheetDeliveryEmail').value.trim() });
}

function updateDirtyState() {
  const dirty = Boolean(currentProfile) && editableState() !== initialEditableState;
  $('saveBtn').disabled = !dirty || profileSaving;
  $('profileForm').classList.toggle('dirty', dirty);
  return dirty;
}

function updateCompletion(profile) {
  const checks = [
    Boolean(profile.name),
    Boolean(profile.mobile_number),
    Boolean(profile.has_profile_photo),
    Boolean(profile.email)
  ];
  const completed = checks.filter(Boolean).length;
  const percent = Math.round((completed / checks.length) * 100);
  $('completionPercent').textContent = `${percent}%`;
  $('completionBar').style.width = `${percent}%`;

  const missing = [];
  if (!profile.mobile_number) missing.push('mobile number');
  if (!profile.has_profile_photo) missing.push('profile photo');
  $('completionHint').textContent = missing.length
    ? `Complete: ${missing.join(', ')}.`
    : 'Your contact profile is complete.';
}

function closePhotoViewer(fromOverlay=false) {
  if (!photoViewerEl || photoViewerEl.hidden) return;
  photoViewerEl.hidden = true;
  photoViewerEl.setAttribute('aria-hidden', 'true');
  viewerImageEl.classList.remove('zoomed');
  viewerImageEl.removeAttribute('src');
  if(fromOverlay!==true)window.VoxelOverlay?.close('profilePhotoViewer');
  document.body.style.overflow = '';
  avatarWrapEl?.focus?.({ preventScroll: true });
}

function openPhotoViewer() {
  if (!currentProfile?.has_profile_photo || !avatarEl?.src || avatarEl.style.display === 'none') return;
  viewerImageEl.classList.remove('zoomed');
  const objectUrl=window.VoxelAvatar?.objectUrl(avatarWrapEl);
  if(!objectUrl)return;
  viewerImageEl.src = objectUrl;
  photoViewerEl.hidden = false;
  photoViewerEl.setAttribute('aria-hidden', 'false');
  window.VoxelOverlay?.open({id:'profilePhotoViewer',element:photoViewerEl,onClose:()=>closePhotoViewer(true),returnFocus:avatarWrapEl});
  document.body.style.overflow = 'hidden';
  $('viewerClose')?.focus?.({ preventScroll: true });
}

function renderPhoto(profile,{publish=true}={}) {
  initialsEl.textContent = initials(profile.name);
  $('photoStatus').textContent = profile.has_profile_photo ? 'Uploaded' : 'Not uploaded';
  $('photoUpdated').textContent = displayDate(profile.profile_photo_updated_at);
  $('removePhotoBtn').disabled = !profile.has_profile_photo;
  avatarWrapEl.classList.toggle('canOpen', Boolean(profile.has_profile_photo && profile.profile_photo_url));
  avatarWrapEl.setAttribute('aria-disabled', profile.has_profile_photo ? 'false' : 'true');
  avatarWrapEl.title = profile.has_profile_photo ? 'Tap to view full-size photo' : 'Upload a profile photo to enable full-size view';
  if(!profile.has_profile_photo)closePhotoViewer();
  window.VoxelAvatar.mount(avatarWrapEl,{self:true,image:avatarEl,fallback:initialsEl,onState({state,message}){
    const retry=$('retryPhotoBtn');if(retry)retry.hidden=state!=='failed';
    if(state==='failed')setStatus(message || 'Photo loading failed. Retry the photo.','error');
  }});
  if(publish)window.VoxelAvatar.updateSelf(profile);
  updateCompletion(profile);
}

function renderProfile(profile,{publishPhoto=true}={}) {
  currentProfile = profile;
  $('name').value = profile.name || '';
  $('mobile').value = profile.mobile_number || '';
  $('timesheetDeliveryEmail').value = profile.timesheet_delivery_email || '';
  $('timesheetDeliveryError').textContent = '';
  $('timesheetDeliveryEmail').removeAttribute('aria-invalid');
  $('email').value = profile.email || '';
  $('username').value = profile.username || '';
  $('displayName').textContent = profile.name || 'My Profile';
  $('roleBadge').textContent = String(profile.role || 'user').replaceAll('_', ' ');
  $('accountStatus').textContent = profile.account_status || (profile.active ? 'ACTIVE' : 'INACTIVE');
  $('profileUpdated').textContent = displayDate(profile.profile_updated_at);
  $('backLink').href = profilePortal(profile.role);
  initialEditableState = editableState();
  updateDirtyState();
  renderPhoto(profile,{publish:publishPhoto});
}

async function loadProfile() {
  setStatus('Loading profile…');
  try {
    const profile = await window.VoxelAvatar.refreshSelf({force:true});
    if(!profile)throw new Error('Your profile could not be loaded. Retry or sign in again.');
    renderProfile(profile,{publishPhoto:false});
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
    $('retryPhotoBtn').hidden=false;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (profileSaving || !currentProfile) return;
  const accountId=Number(currentProfile.id);
  const saveBtn = $('saveBtn');
  const name = $('name').value.trim();
  const mobile = $('mobile').value.trim();
  const timesheetDeliveryEmail = $('timesheetDeliveryEmail').value.trim();
  $('timesheetDeliveryError').textContent = '';
  $('timesheetDeliveryEmail').removeAttribute('aria-invalid');
  if (!name) return setStatus('Full name is required.', 'error');
  if (timesheetDeliveryEmail && (!$('timesheetDeliveryEmail').checkValidity() || /[,;<>\r\n]/.test(timesheetDeliveryEmail))) {
    $('timesheetDeliveryError').textContent = 'Enter one valid email address, or leave blank to disable delivery.';
    $('timesheetDeliveryEmail').setAttribute('aria-invalid', 'true');
    $('timesheetDeliveryEmail').focus();
    return setStatus('Check the timesheet delivery email.', 'error');
  }

  profileSaving = true;
  saveBtn.disabled = true;
  setStatus('Saving changes…');
  try {
    const data = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ name, mobile_number: mobile, timesheet_delivery_email: timesheetDeliveryEmail || null })
    });
    if(Number(currentProfile?.id)!==accountId)return;
    if (currentProfile) {
      currentProfile.name = data.profile?.name ?? name;
      currentProfile.mobile_number = data.profile?.mobile_number ?? (mobile || null);
      currentProfile.timesheet_delivery_email = data.profile?.timesheet_delivery_email ?? null;
      currentProfile.profile_updated_at = new Date().toISOString();
      renderProfile(currentProfile);
    }
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    if (storedUser && typeof storedUser === 'object') {
      storedUser.name = name;
      localStorage.setItem('user', JSON.stringify(storedUser));
    }
    setStatus('Profile updated successfully.', 'ok');
  } catch (error) {
    if (error.fields?.timesheet_delivery_email) {
      $('timesheetDeliveryError').textContent = error.fields.timesheet_delivery_email;
      $('timesheetDeliveryEmail').setAttribute('aria-invalid', 'true');
      $('timesheetDeliveryEmail').focus();
    }
    setStatus(error.message, 'error');
  } finally {
    profileSaving = false;
    updateDirtyState();
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this photo for upload.')), 'image/jpeg', quality);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo format cannot be processed on this phone. Try another photo or take a new one.'));
    };
    image.src = url;
  });
}

async function prepareProfilePhoto(file) {
  if (!file) throw new Error('Choose or take a photo first.');
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error('This photo is too large. Choose a photo under 20 MB.');
  if (file.type && !file.type.startsWith('image/')) throw new Error('Choose an image file.');

  const image = await loadImage(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (!originalWidth || !originalHeight) throw new Error('The selected photo could not be read.');

  if(originalWidth*originalHeight>24000000 || originalWidth>12000 || originalHeight>12000)throw new Error('Choose a photo up to 24 megapixels.');
  const crop=await choosePhotoCrop(image);
  if(!crop)return null;
  const width=512,height=512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Your browser could not prepare the photo.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle='#ffffff';context.fillRect(0,0,width,height);
  const side=Math.min(originalWidth,originalHeight)/crop.zoom;
  context.drawImage(image,(originalWidth-side)*crop.x,(originalHeight-side)*crop.y,side,side,0,0,width,height);

  let quality = 0.86;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > TARGET_UPLOAD_BYTES && quality > 0.5) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > 2 * 1024 * 1024) throw new Error('The photo is still too large after optimization. Try a different photo.');
  return new File([blob], `profile-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function uploadPhoto(file) {
  if (!file || photoSaving || !currentProfile) return;
  const accountId=Number(currentProfile.id);
  photoSaving=true;
  $('takePhotoBtn').disabled = true;
  $('choosePhotoBtn').disabled = true;
  setStatus('Preparing photo…');
  try {
    const preparedFile = await prepareProfilePhoto(file);
    if(!preparedFile){setStatus('Photo upload cancelled. Your current photo is unchanged.');return;}
    if(Number(currentProfile?.id)!==accountId)throw new Error('Your account changed. Choose a photo again for the current account.');
    setStatus('Uploading profile photo…');
    const formData = new FormData();
    formData.append('photo', preparedFile, preparedFile.name);
    const data = await api('/api/profile/photo', { method: 'POST', body: formData });
    if (currentProfile && Number(currentProfile.id)===accountId) {
      Object.assign(currentProfile,data);
      closePhotoViewer();
      renderPhoto(currentProfile);
    }
    setStatus('Profile photo updated successfully.', 'ok');
  } catch (error) {
    setStatus(error.message || 'Profile photo could not be uploaded. Please try again.', 'error');
  } finally {
    photoSaving=false;
    $('takePhotoBtn').disabled = false;
    $('choosePhotoBtn').disabled = false;
    $('cameraInput').value = '';
    $('galleryInput').value = '';
  }
}

async function removePhoto() {
  if (!currentProfile?.has_profile_photo || photoSaving) return;
  const accountId=Number(currentProfile.id);
  photoSaving=true;
  $('removePhotoBtn').disabled = true;
  setStatus('Removing profile photo…');
  try {
    const data=await api('/api/profile/photo', { method: 'DELETE' });
    if(Number(currentProfile?.id)!==accountId)return;
    Object.assign(currentProfile,data);
    currentProfile.profile_photo_updated_at = null;
    renderPhoto(currentProfile);
    setStatus('Profile photo removed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
    $('removePhotoBtn').disabled = false;
  }finally{photoSaving=false;}
}

function choosePhotoCrop(image){
  return new Promise(resolve=>{
    closePhotoViewer();
    const dialog=document.createElement('div');dialog.className='profileCropOverlay';dialog.id='profilePhotoCrop';
    dialog.innerHTML='<section class="profileCropPanel" role="dialog" aria-modal="true" aria-labelledby="profileCropTitle"><h2 id="profileCropTitle">Position your photo</h2><p>Choose the square shown in your account avatar.</p><canvas id="profileCropCanvas" width="320" height="320" aria-label="Photo crop preview"></canvas><label>Horizontal position<input id="profileCropX" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>Vertical position<input id="profileCropY" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>Zoom<input id="profileCropZoom" type="range" min="1" max="3" step="0.01" value="1"></label><div class="profileCropActions"><button type="button" class="btn" id="profileCropCancel">Cancel</button><button type="button" class="btn primary" id="profileCropConfirm">Use this photo</button></div></section>';
    document.body.append(dialog);let settled=false;
    const x=dialog.querySelector('#profileCropX'),y=dialog.querySelector('#profileCropY'),zoom=dialog.querySelector('#profileCropZoom'),canvas=dialog.querySelector('canvas');
    const value=()=>({x:Number(x.value),y:Number(y.value),zoom:Number(zoom.value)});
    const render=()=>{const crop=value(),side=Math.min(image.naturalWidth||image.width,image.naturalHeight||image.height)/crop.zoom;const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,320,320);context.drawImage(image,((image.naturalWidth||image.width)-side)*crop.x,((image.naturalHeight||image.height)-side)*crop.y,side,side,0,0,320,320);};
    const finish=result=>{if(settled)return;settled=true;window.VoxelOverlay?.close('profilePhotoCrop');dialog.remove();resolve(result);};
    [x,y,zoom].forEach(control=>control.addEventListener('input',render));
    dialog.querySelector('#profileCropCancel').onclick=()=>finish(null);dialog.querySelector('#profileCropConfirm').onclick=()=>finish(value());
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();finish(null);}else if(event.key==='Tab'){const controls=[...dialog.querySelectorAll('button,input')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    if(window.VoxelOverlay)window.VoxelOverlay.open({id:'profilePhotoCrop',element:dialog,onClose:()=>finish(null),returnFocus:$('choosePhotoBtn')});
    render();dialog.querySelector('#profileCropConfirm').focus();
  });
}

$('profileForm').addEventListener('submit', saveProfile);
$('name').addEventListener('input', updateDirtyState);
$('mobile').addEventListener('input', updateDirtyState);
$('timesheetDeliveryEmail').addEventListener('input', updateDirtyState);
$('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
$('choosePhotoBtn').addEventListener('click', () => $('galleryInput').click());
$('removePhotoBtn').addEventListener('click', removePhoto);
$('retryPhotoBtn')?.addEventListener('click',()=>currentProfile?window.VoxelAvatar.retrySelf():loadProfile());
window.addEventListener('vv:avatar-auth-required',()=>redirectToLogin('Your session expired. Please login again.'));
window.addEventListener('vv:avatar-clear',()=>{
  closePhotoViewer();currentProfile=null;
  ['name','mobile','timesheetDeliveryEmail','email','username'].forEach(id=>$(id).value='');
  $('displayName').textContent='My Profile';$('roleBadge').textContent='User';$('accountStatus').textContent='—';
  $('photoStatus').textContent='Not uploaded';$('photoUpdated').textContent='—';$('profileUpdated').textContent='—';
  $('removePhotoBtn').disabled=true;updateCompletion({});updateDirtyState();
});
window.addEventListener('vv:avatar-profile',event=>{
  const next=event.detail?.profile;if(!next)return;
  if(!currentProfile || Number(currentProfile.id)!==Number(next.id)){renderProfile(next,{publishPhoto:false});return;}
  for(const key of ['has_profile_photo','profile_photo_url','profile_photo_revision','profile_photo_mime','profile_photo_size','profile_photo_updated_at'])currentProfile[key]=next[key];
  renderPhoto(currentProfile,{publish:false});
});
$('cameraInput').addEventListener('change', (event) => uploadPhoto(event.target.files?.[0]));
$('galleryInput').addEventListener('change', (event) => uploadPhoto(event.target.files?.[0]));
avatarWrapEl.addEventListener('click', openPhotoViewer);
avatarWrapEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openPhotoViewer();
  }
});
$('viewerClose').addEventListener('click', closePhotoViewer);
photoViewerEl.addEventListener('click', (event) => {
  if (event.target === photoViewerEl || event.target.classList.contains('photoViewerInner')) closePhotoViewer();
});
viewerImageEl.addEventListener('click', (event) => {
  event.stopPropagation();
  viewerImageEl.classList.toggle('zoomed');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePhotoViewer();
});
window.addEventListener('beforeunload', (event) => {
  if (!updateDirtyState()) return;
  event.preventDefault();
  event.returnValue = '';
});

loadProfile();
