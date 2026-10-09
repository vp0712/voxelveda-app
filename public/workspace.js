(() => {
  'use strict';
  let identityLoaded = false;
  let submitting = false;
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
    identityLoaded = false;
    el('rfqFields').disabled = true;
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
      el('customerName').value = user.name || user.username || '';
      el('customerEmail').value = user.email || '';
      identityLoaded = true;
      el('rfqFields').disabled = false;
      status('workspaceStatus', '');
    } catch (error) {
      el('profileName').textContent = 'Unavailable';
      el('profileEmail').textContent = 'Unavailable';
      status('workspaceStatus', error.name === 'AbortError' ? 'Loading your account timed out. Please retry.' : 'We could not load your account. Please retry or contact support.', 'error');
      el('retryIdentity').hidden = false;
    }
  }
  async function submitRequest(event) {
    event.preventDefault();
    if (submitting || !identityLoaded) return;
    if (!el('workspaceRfqForm').reportValidity()) return;
    if (!el('rfqPrivacy').checked) return status('rfqStatus', 'Accept the Privacy Policy before submitting.', 'error');
    const deadline = el('projectDeadline').value;
    const body = {
      customer_name: el('customerName').value.trim(),
      email: el('customerEmail').value.trim(),
      phone: el('customerPhone').value.trim(),
      material: el('projectMaterial').value.trim(),
      quantity: Number(el('projectQuantity').value),
      application: [el('projectDetails').value.trim(), deadline ? 'Target date: ' + deadline : ''].filter(Boolean).join('\n')
    };
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000000) return status('rfqStatus', 'Quantity must be a whole number from 1 to 1,000,000.', 'error');
    submitting = true;
    el('rfqSubmit').disabled = true;
    el('rfqSubmit').setAttribute('aria-busy', 'true');
    el('rfqSubmit').textContent = 'Submitting…';
    status('rfqStatus', 'Submitting your request…');
    try {
      const { response, data } = await request('/api/public/rfq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 30000);
      if (!response.ok) return status('rfqStatus', data.message || 'Your request could not be submitted. Please try again.', 'error');
      if (!data.rfq_id) return status('rfqStatus', 'The server did not confirm a request reference. Contact support before submitting again.', 'error');
      status('rfqStatus', 'Your request was submitted. Reference #' + data.rfq_id + '.', 'success');
      ['customerPhone', 'projectMaterial', 'projectDeadline', 'projectDetails'].forEach((id) => { el(id).value = ''; });
      el('projectQuantity').value = '1';
      el('rfqPrivacy').checked = false;
    } catch (error) {
      status('rfqStatus', error.name === 'AbortError' ? 'Confirmation timed out. Your request may have been received. Contact support before submitting again.' : 'We could not confirm your request. Contact support before submitting again.', 'error');
    } finally {
      submitting = false;
      el('rfqSubmit').disabled = false;
      el('rfqSubmit').setAttribute('aria-busy', 'false');
      el('rfqSubmit').textContent = 'Submit request';
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
  el('workspaceRfqForm').addEventListener('submit', submitRequest);
  el('retryIdentity').addEventListener('click', loadIdentity);
  el('logoutButton').addEventListener('click', logout);
  loadIdentity();
})();
