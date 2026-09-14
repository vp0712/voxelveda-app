let currentProfile = null;
let initialEditableState = '';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const avatarEl = $('avatar');
const initialsEl = $('initials');
const avatarWrapEl = $('avatarWrap');
const photoViewerEl = $('photoViewer');
const viewerImageEl = $('viewerImage');
const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = 1400 * 1024;
const MAX_PROFILE_DIMENSION = 1600;

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
  return ['admin', 'super_admin', 'finance_admin', 'finance_user', 'accountant'].includes(String(role || '').toLowerCase())
    ? '/admin'
    : '/dashboard';
}

function redirectToLogin(message = 'Please login to continue.') {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
  const params = new URLSearchParams({ message });
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
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
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
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function editableState() {
  return JSON.stringify({ name: $('name').value.trim(), mobile_number: $('mobile').value.trim() });
}

function updateDirtyState() {
  const dirty = Boolean(currentProfile) && editableState() !== initialEditableState;
  $('saveBtn').disabled = !dirty;
  $('profileForm').classList.toggle('dirty', dirty);
  return dirty;
}

function updateCompletion(profile) {
  const checks = [
    Boolean(profile.name),
    Boolean(profile.mobile_number),
    Boolean(profile.has_profile_photo),
    Boolean(profile.email),
    Boolean(profile.employee_number),
    Boolean(profile.department)
  ];
  const completed = checks.filter(Boolean).length;
  const percent = Math.round((completed / checks.length) * 100);
  $('completionPercent').textContent = `${percent}%`;
  $('completionBar').style.width = `${percent}%`;

  const missing = [];
  if (!profile.mobile_number) missing.push('mobile number');
  if (!profile.has_profile_photo) missing.push('profile photo');
  if (!profile.department) missing.push('department assignment');
  if (!profile.employee_number) missing.push('employee number');
  $('completionHint').textContent = missing.length
    ? `Complete: ${missing.join(', ')}.`
    : 'Your profile is complete and ready for internal use.';
}

function closePhotoViewer() {
  if (!photoViewerEl || photoViewerEl.hidden) return;
  photoViewerEl.hidden = true;
  photoViewerEl.setAttribute('aria-hidden', 'true');
  viewerImageEl.classList.remove('zoomed');
  viewerImageEl.removeAttribute('src');
  document.body.style.overflow = '';
  avatarWrapEl?.focus?.({ preventScroll: true });
}

function openPhotoViewer() {
  if (!currentProfile?.has_profile_photo || !avatarEl?.src || avatarEl.style.display === 'none') return;
  viewerImageEl.classList.remove('zoomed');
  viewerImageEl.src = `${currentProfile.profile_photo_url}${currentProfile.profile_photo_url.includes('?') ? '&' : '?'}full=${Date.now()}`;
  photoViewerEl.hidden = false;
  photoViewerEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('viewerClose')?.focus?.({ preventScroll: true });
}

function renderPhoto(profile) {
  initialsEl.textContent = initials(profile.name);
  $('photoStatus').textContent = profile.has_profile_photo ? 'Uploaded' : 'Not uploaded';
  $('photoUpdated').textContent = displayDate(profile.profile_photo_updated_at);
  $('removePhotoBtn').disabled = !profile.has_profile_photo;
  avatarWrapEl.classList.toggle('canOpen', Boolean(profile.has_profile_photo && profile.profile_photo_url));
  avatarWrapEl.setAttribute('aria-disabled', profile.has_profile_photo ? 'false' : 'true');
  avatarWrapEl.title = profile.has_profile_photo ? 'Tap to view full-size photo' : 'Upload a profile photo to enable full-size view';
  if (!profile.has_profile_photo || !profile.profile_photo_url) {
    closePhotoViewer();
    avatarEl.removeAttribute('src');
    avatarEl.style.display = 'none';
    initialsEl.style.display = 'block';
    updateCompletion(profile);
    return;
  }
  avatarEl.onload = () => {
    avatarEl.style.display = 'block';
    initialsEl.style.display = 'none';
  };
  avatarEl.onerror = () => {
    avatarEl.style.display = 'none';
    initialsEl.style.display = 'block';
  };
  avatarEl.src = `${profile.profile_photo_url}${profile.profile_photo_url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  updateCompletion(profile);
}

function renderProfile(profile) {
  currentProfile = profile;
  $('name').value = profile.name || '';
  $('mobile').value = profile.mobile_number || '';
  $('email').value = profile.email || '';
  $('username').value = profile.username || '';
  $('department').value = profile.department || 'Not assigned';
  $('employeeNumber').value = profile.employee_number || 'Not assigned';
  $('displayName').textContent = profile.name || 'My Profile';
  $('roleBadge').textContent = String(profile.role || 'user').replaceAll('_', ' ');
  $('accountStatus').textContent = profile.account_status || (profile.active ? 'ACTIVE' : 'INACTIVE');
  $('profileUpdated').textContent = displayDate(profile.profile_updated_at);
  $('backLink').href = profilePortal(profile.role);
  initialEditableState = editableState();
  updateDirtyState();
  renderPhoto(profile);
}

async function loadProfile() {
  setStatus('Loading profile…');
  try {
    const { profile } = await api('/api/profile');
    renderProfile(profile);
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const saveBtn = $('saveBtn');
  const name = $('name').value.trim();
  const mobile = $('mobile').value.trim();
  if (!name) return setStatus('Full name is required.', 'error');

  saveBtn.disabled = true;
  setStatus('Saving changes…');
  try {
    const data = await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ name, mobile_number: mobile })
    });
    if (currentProfile) {
      currentProfile.name = data.profile?.name ?? name;
      currentProfile.mobile_number = data.profile?.mobile_number ?? (mobile || null);
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
    setStatus(error.message, 'error');
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

  const scale = Math.min(1, MAX_PROFILE_DIMENSION / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Your browser could not prepare the photo.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

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
  if (!file) return;
  $('takePhotoBtn').disabled = true;
  $('choosePhotoBtn').disabled = true;
  setStatus('Preparing photo…');
  try {
    const preparedFile = await prepareProfilePhoto(file);
    setStatus('Uploading profile photo…');
    const formData = new FormData();
    formData.append('photo', preparedFile, preparedFile.name);
    const data = await api('/api/profile/photo', { method: 'POST', body: formData });
    if (currentProfile) {
      currentProfile.has_profile_photo = true;
      currentProfile.profile_photo_url = data.profile_photo_url;
      currentProfile.profile_photo_updated_at = new Date().toISOString();
      renderPhoto(currentProfile);
    }
    setStatus('Profile photo updated successfully.', 'ok');
  } catch (error) {
    setStatus(error.message || 'Profile photo could not be uploaded. Please try again.', 'error');
  } finally {
    $('takePhotoBtn').disabled = false;
    $('choosePhotoBtn').disabled = false;
    $('cameraInput').value = '';
    $('galleryInput').value = '';
  }
}

async function removePhoto() {
  if (!currentProfile?.has_profile_photo) return;
  $('removePhotoBtn').disabled = true;
  setStatus('Removing profile photo…');
  try {
    await api('/api/profile/photo', { method: 'DELETE' });
    currentProfile.has_profile_photo = false;
    currentProfile.profile_photo_url = null;
    currentProfile.profile_photo_updated_at = new Date().toISOString();
    renderPhoto(currentProfile);
    setStatus('Profile photo removed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
    $('removePhotoBtn').disabled = false;
  }
}

$('profileForm').addEventListener('submit', saveProfile);
$('name').addEventListener('input', updateDirtyState);
$('mobile').addEventListener('input', updateDirtyState);
$('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
$('choosePhotoBtn').addEventListener('click', () => $('galleryInput').click());
$('removePhotoBtn').addEventListener('click', removePhoto);
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
