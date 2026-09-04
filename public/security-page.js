const statusNode = document.getElementById('status');
const showStatus = (message, ok = false) => { statusNode.textContent = message; statusNode.style.color = ok ? '#22c55e' : '#f87171'; };
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; }
async function loadSessions() {
  const response = await fetch('/api/auth/sessions');
  if (response.status === 401) return location.replace('/login?returnTo=/security');
  const data = await response.json();
  document.getElementById('sessions').innerHTML = (data.sessions || []).map((session) => `<article><strong>${session.current ? 'Current session' : 'Active session'}</strong><p>${escapeHtml(session.user_agent || 'Unknown device')}</p><small>Last activity: ${new Date(session.last_seen_at).toLocaleString()}</small>${session.current ? '' : `<button class="button button-secondary revoke-session" data-id="${session.id}">Sign out</button>`}</article>`).join('') || '<p>No active sessions.</p>';
}
document.addEventListener('click', async (event) => { const button = event.target.closest('.revoke-session'); if (!button) return; const response = await fetch(`/api/auth/sessions/${button.dataset.id}`, { method: 'DELETE' }); showStatus((await response.json()).message, response.ok); if (response.ok) loadSessions(); });
document.getElementById('revokeOthers').addEventListener('click', async () => { const response = await fetch('/api/auth/sessions/revoke-others', { method: 'POST' }); showStatus((await response.json()).message, response.ok); if (response.ok) loadSessions(); });
document.getElementById('changePasswordForm').addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: document.getElementById('currentPassword').value, new_password: document.getElementById('newPassword').value }) }); const data = await response.json(); showStatus(data.message, response.ok); if (response.ok) setTimeout(() => location.replace('/login'), 1000); });
loadSessions();
