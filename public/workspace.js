(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const clearSavedIdentity = () => ['user', 'role', 'token'].forEach((key) => localStorage.removeItem(key));
  function status(id, message, tone = 'info') {
    const node = el(id);
    node.textContent = message;
    node.dataset.tone = tone;
  }
  async function request(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const data = type.includes('application/json') ? await response.json() : {};
      return { response, data };
    } finally { clearTimeout(timer); }
  }
  function loginAgain() {
    clearSavedIdentity();
    window.location.replace('/login?returnTo=' + encodeURIComponent('/dashboard' + window.location.hash));
  }
  async function loadIdentity() {
    el('retryIdentity').hidden = true;
    status('workspaceStatus', 'Loading your account…');
    try {
      const { response, data } = await request('/api/auth/me');
      if (response.status === 401) return loginAgain();
      if (!response.ok || !data.user) throw new Error('identity unavailable');
      const user = data.user;
      const name = user.name || user.username || 'Your account';
      el('welcomeTitle').textContent = 'Welcome, ' + name;
      el('profileName').textContent = name;
      el('profileEmail').textContent = user.email || 'Not available';
      status('workspaceStatus', '');
    } catch (error) {
      el('profileName').textContent = 'Unavailable';
      el('profileEmail').textContent = 'Unavailable';
      status('workspaceStatus', error.name === 'AbortError' ? 'Loading your account timed out. Please retry.' : 'We could not load your account. Please retry or contact support.', 'error');
      el('retryIdentity').hidden = false;
    }
  }
  async function logout() {
    el('logoutButton').disabled = true;
    try {
      const { response } = await request('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('logout unavailable');
      clearSavedIdentity();
      window.location.replace('/login');
    } catch {
      status('workspaceStatus', 'Sign out could not be confirmed. Please retry.', 'error');
      el('logoutButton').disabled = false;
    }
  }
  el('year').textContent = String(new Date().getFullYear());
  el('retryIdentity').addEventListener('click', loadIdentity);
  el('logoutButton').addEventListener('click', logout);
  loadIdentity();
})();
