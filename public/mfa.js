(function () {
  const challenge = sessionStorage.getItem('vv_mfa_challenge') || '';
  const setup = sessionStorage.getItem('vv_mfa_setup') === '1';
  const status = document.getElementById('status');
  const setStatus = (message, ok = false) => { status.textContent = message; status.style.color = ok ? '#22c55e' : '#f87171'; };
  function destination(user) {
    const requested = sessionStorage.getItem('vv_mfa_return_to') || '';
    if (requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')) return requested;
    const role = String(user?.role || '').toLowerCase();
    return ['admin', 'super_admin', 'finance_admin', 'finance_user', 'accountant'].includes(role) || user?.permissions?.includes('finance') ? '/admin' : '/dashboard';
  }
  function clearChallenge() {
    sessionStorage.removeItem('vv_mfa_challenge');
    sessionStorage.removeItem('vv_mfa_setup');
    sessionStorage.removeItem('vv_mfa_return_to');
  }
  async function beginSetup() {
    document.getElementById('title').textContent = 'Set up multi-factor authentication';
    const response = await fetch('/api/auth/mfa/setup/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_token: challenge }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.message || 'MFA setup session expired. Sign in again.');
    document.getElementById('setupPanel').hidden = false;
    document.getElementById('qrCode').src = data.qr_code;
    document.getElementById('manualKey').value = data.manual_key;
  }
  if (!challenge) {
    document.getElementById('mfaForm').hidden = true;
    setStatus('Your verification session is missing or expired. Sign in again.');
  } else if (setup) beginSetup();

  document.getElementById('mfaForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const endpoint = setup ? '/api/auth/mfa/setup/confirm' : '/api/auth/mfa/verify';
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_token: challenge, code: document.getElementById('mfaCode').value }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(data.message || 'Verification failed.');
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('role', String(data.user.role || '').toLowerCase());
    if (data.recovery_codes?.length) {
      document.getElementById('mfaForm').hidden = true;
      document.getElementById('setupPanel').hidden = true;
      document.getElementById('recoveryPanel').hidden = false;
      document.getElementById('recoveryCodes').textContent = data.recovery_codes.join('\n');
      setStatus('MFA is enabled. Save the recovery codes before continuing.', true);
      return;
    }
    const target = destination(data.user);
    clearChallenge();
    window.location.replace(target);
  });
  document.getElementById('copyCodes').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('recoveryCodes').textContent).then(() => setStatus('Recovery codes copied.', true)));
  document.getElementById('continueLogin').addEventListener('click', () => { const user = JSON.parse(localStorage.getItem('user') || '{}'); const target = destination(user); clearChallenge(); window.location.replace(target); });
})();
