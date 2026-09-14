let currentProfile = null;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const avatarEl = $('avatar');
const initialsEl = $('initials');

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
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function renderPhoto(profile) {
  initialsEl.textContent = initials(profile.name);
  $('photoStatus').textContent = profile.has_profile_photo ? 'Uploaded' : 'Not uploaded';
  $('removePhotoBtn').disabled = !profile.has_profile_photo;
  if (!profile.has_profile_photo || !profile.profile_photo_url) {
    avatarEl.removeAttribute('src');
    avatarEl.style.display = 'none';
    initialsEl.style.display = 'block';
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
  $('backLink').href = profilePortal(profile.role);
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
    await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ name, mobile_number: mobile })
    });
    if (currentProfile) {
      currentProfile.name = name;
      currentProfile.mobile_number = mobile || null;
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
  } finally {
    saveBtn.disabled = false;
  }
}

async function uploadPhoto(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return setStatus('Choose a JPG, PNG or WebP image.', 'error');
  }
  if (file.size > 5 * 1024 * 1024) return setStatus('Profile photo must be 5 MB or smaller.', 'error');

  $('takePhotoBtn').disabled = true;
  $('choosePhotoBtn').disabled = true;
  setStatus('Uploading profile photo…');
  try {
    const formData = new FormData();
    formData.append('photo', file, file.name || `profile-${Date.now()}.jpg`);
    const data = await api('/api/profile/photo', { method: 'POST', body: formData });
    if (currentProfile) {
      currentProfile.has_profile_photo = true;
      currentProfile.profile_photo_url = data.profile_photo_url;
      renderPhoto(currentProfile);
    }
    setStatus('Profile photo updated successfully.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
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
    renderPhoto(currentProfile);
    setStatus('Profile photo removed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
    $('removePhotoBtn').disabled = false;
  }
}

$('profileForm').addEventListener('submit', saveProfile);
$('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
$('choosePhotoBtn').addEventListener('click', () => $('galleryInput').click());
$('removePhotoBtn').addEventListener('click', removePhoto);
$('cameraInput').addEventListener('change', (event) => uploadPhoto(event.target.files?.[0]));
$('galleryInput').addEventListener('change', (event) => uploadPhoto(event.target.files?.[0]));

loadProfile();
