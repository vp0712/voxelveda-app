(function () {
  const status = document.getElementById('status');
  const setStatus = (message, ok = false) => { if (status) { status.textContent = message; status.style.color = ok ? '#22c55e' : '#f87171'; } };
  document.getElementById('recoveryForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('recoveryEmail').value.trim();
    const response = await fetch('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await response.json().catch(() => ({}));
    setStatus(data.message || 'If the account exists, a reset link will be sent.', true);
  });
  document.getElementById('passwordTokenForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    if (password !== document.getElementById('confirmPassword').value) return setStatus('Passwords do not match.');
    const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || '';
    const endpoint = event.currentTarget.dataset.type === 'invite' ? '/api/auth/invitation/accept' : '/api/auth/password-reset/complete';
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.message || 'Unable to update password.');
    history.replaceState({}, document.title, location.pathname);
    setStatus(data.message, true);
    setTimeout(() => location.replace('/login?message=' + encodeURIComponent('Password updated. Please sign in.')), 1200);
  });
})();
