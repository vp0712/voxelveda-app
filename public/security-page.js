const statusNode = document.getElementById('status');
const showStatus = (message, ok = false) => { statusNode.textContent = message; statusNode.style.color = ok ? '#22c55e' : '#f87171'; };
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; }
async function loadMfaStatus() {
  const response = await fetch('/api/auth/mfa/status');
  if (response.status === 401) return location.replace('/login?returnTo=/security');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showStatus(data.message || 'Unable to load MFA status.');
  document.getElementById('mfaStatus').textContent = data.enabled
    ? `Enabled · ${data.recovery_codes_remaining} recovery codes remaining · assurance level ${data.assurance_level}`
    : data.required ? 'Required for your role — setup must be completed now.' : 'Not enabled — strongly recommended.';
  document.getElementById('mfaStartForm').hidden = data.enabled;
}
async function loadSessions() {
  const response = await fetch('/api/auth/sessions');
  if (response.status === 401) return location.replace('/login?returnTo=/security');
  const data = await response.json();
  document.getElementById('sessions').innerHTML = (data.sessions || []).map((session) => `<article><strong>${session.current ? 'Current session' : 'Active session'}</strong><p>${escapeHtml(session.user_agent || 'Unknown device')}</p><small>Last activity: ${new Date(session.last_seen_at).toLocaleString()}</small>${session.current ? '' : `<button class="button button-secondary revoke-session" data-id="${session.id}">Sign out</button>`}</article>`).join('') || '<p>No active sessions.</p>';
}
document.addEventListener('click', async (event) => { const button = event.target.closest('.revoke-session'); if (!button) return; const response = await fetch(`/api/auth/sessions/${button.dataset.id}`, { method: 'DELETE' }); showStatus((await response.json()).message, response.ok); if (response.ok) loadSessions(); });
document.getElementById('revokeOthers').addEventListener('click', async () => { const response = await fetch('/api/auth/sessions/revoke-others', { method: 'POST' }); showStatus((await response.json()).message, response.ok); if (response.ok) loadSessions(); });
document.getElementById('changePasswordForm').addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: document.getElementById('currentPassword').value, new_password: document.getElementById('newPassword').value }) }); const data = await response.json(); showStatus(data.message, response.ok); if (response.ok) setTimeout(() => location.replace('/login'), 1000); });
document.getElementById('mfaStartForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/auth/mfa/enroll/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: document.getElementById('mfaPassword').value }) });
  const data = await response.json().catch(() => ({}));
  showStatus(data.message || (response.ok ? 'Scan the code and confirm setup.' : 'Unable to start MFA setup.'), response.ok);
  if (!response.ok) return;
  document.getElementById('mfaSetup').hidden = false;
  document.getElementById('mfaQr').src = data.qr_code;
  document.getElementById('mfaManual').value = data.manual_key;
});
document.getElementById('mfaConfirmForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/auth/mfa/enroll/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('mfaConfirmCode').value }) });
  const data = await response.json().catch(() => ({}));
  showStatus(data.message || 'Unable to confirm MFA.', response.ok);
  if (!response.ok) return;
  document.getElementById('newRecovery').hidden = false;
  document.getElementById('newRecoveryCodes').textContent = (data.recovery_codes || []).join('\n');
  document.getElementById('mfaSetup').hidden = true;
  document.getElementById('mfaStartForm').hidden = true;
});
loadSessions();
loadMfaStatus();
