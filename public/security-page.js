(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const pending = new Map(), uncertain = new Map(), reads = { mfa: 0, sessions: 0 };
  let epoch = 0, knownSessions = [], sessionsLoaded = false, recoverySaved = false;
  const account = () => { try { return String(JSON.parse(localStorage.getItem('user') || 'null')?.id || ''); } catch { return ''; } };
  let displayedAccount = account();
  const current = owned => owned.epoch === epoch && owned.account === account();
  const owner = () => ({ epoch, account: account() });
  const escapeHtml = value => { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; };
  function showStatus(message, ok = false) {
    const node = byId('status'); node.textContent = message;
    node.style.color = ok ? 'var(--success)' : 'var(--danger)'; node.setAttribute('role', ok ? 'status' : 'alert');
  }
  function foreground(message, origin) {
    showStatus(message);
    if (window.VoxelFeedback?.show) window.VoxelFeedback.show({ kind: 'error', title: 'Security action not confirmed', message,
      actions: [{ label: 'Return to form' }] }).then(() => origin?.focus?.()).catch(() => {});
    else origin?.focus?.();
  }
  async function request(url, options = {}) {
    const owned = owner(), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000), write = Boolean(options.method);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
        headers: { ...(write ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
      if (response.status === 401) {
        // An old-account response cannot navigate the new account. Enrollment
        // revokes sessions before returning one-time codes, so an older read's
        // expected 401 must not replace that successful response/visible codes.
        const ownConfirm = write && url === '/api/auth/mfa/enroll/confirm';
        if (current(owned) && byId('newRecovery').hidden &&
            (!(pending.has('mfaConfirm') || uncertain.has('mfaConfirm')) || ownConfirm)) location.replace('/login?returnTo=%2Fsecurity');
        throw Object.assign(new Error('Sign in again to manage account security.'), { auth: true });
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error(data?.message || 'The security request failed. Review it before trying again.'), { uncertain: write && response.status >= 500 });
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('The security response could not be verified.'), { uncertain: write });
      return data;
    } catch (error) {
      if (write && (error.name === 'AbortError' || error instanceof TypeError)) error.uncertain = true;
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function formBusy(form, busy) {
    form.setAttribute('aria-busy', String(busy));
    form.querySelectorAll('input,button').forEach(node => { node.disabled = busy; });
  }
  function holdButtons(form, button, held) {
    if (form) { formBusy(form, held); if (!held) delete form.dataset.nativeRequestState; }
    else if (button) button.disabled = held;
  }
  async function writeAction({ key, form, button, url, method = 'POST', body, accepted, hold = {} }) {
    if (pending.has(key) || uncertain.has(key)) return;
    const owned = owner(), token = Symbol(key); pending.set(key, token); holdButtons(form, button, true);
    if (form) form.dataset.nativeRequestState = 'pending';
    try {
      const data = await request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!current(owned)) return;
      await accepted(data);
    } catch (error) {
      if (!current(owned) || error.auth) return;
      if (error.uncertain) { uncertain.set(key, { ...hold, form, button }); if (form) form.dataset.nativeRequestState = 'uncertain'; }
      foreground(error.uncertain
        ? 'The server result is uncertain. Check the current MFA/session status before another action. This request will not be sent again automatically; refresh this page before retrying a password or setup request.'
        : error.message, form?.querySelector('input') || button);
    } finally {
      if (pending.get(key) === token) pending.delete(key);
      if (current(owned)) {
        holdButtons(form, button, uncertain.has(key));
        if (form && uncertain.has(key)) form.setAttribute('aria-busy', 'false');
      }
    }
  }
  async function loadMfaStatus() {
    const ticket = ++reads.mfa, owned = owner(), node = byId('mfaStatus'); node.setAttribute('aria-busy', 'true');
    byId('retryMfaBtn').hidden = true;
    try {
      const data = await request('/api/auth/mfa/status'); if (!current(owned) || ticket !== reads.mfa) return;
      if (typeof data.enabled !== 'boolean') throw new Error('MFA status is unavailable. Retry the status check.');
      node.textContent = data.enabled ? `Enabled · ${Number(data.recovery_codes_remaining) || 0} recovery codes remaining`
        : data.required ? 'Required for your role — setup must be completed now.' : 'Not enabled — strongly recommended.';
      byId('mfaStartForm').hidden = data.enabled;
      if (data.enabled) { byId('mfaSetup').hidden = true; byId('mfaPassword').value = ''; byId('mfaConfirmCode').value = ''; byId('mfaManual').value = ''; byId('mfaQr').removeAttribute('src'); }
      if (data.enabled && uncertain.has('mfaConfirm')) {
        const held = uncertain.get('mfaConfirm'); uncertain.delete('mfaConfirm'); holdButtons(held.form, held.button, false);
        showStatus('Authenticator status is confirmed enabled. The earlier recovery-code response was not confirmed; no codes were invented or another confirmation submitted.', true);
      }
    } catch (error) {
      if (!current(owned) || ticket !== reads.mfa || error.auth) return;
      node.textContent = 'MFA status unavailable. Retry to check the saved account state.'; byId('retryMfaBtn').hidden = false;
    } finally { if (current(owned) && ticket === reads.mfa) node.setAttribute('aria-busy', 'false'); }
  }
  async function loadSessions() {
    const ticket = ++reads.sessions, owned = owner(), node = byId('sessions'), status = byId('sessionsStatus');
    node.setAttribute('aria-busy', 'true'); status.textContent = 'Loading sessions…'; byId('retrySessionsBtn').hidden = true;
    try {
      const data = await request('/api/auth/sessions'); if (!current(owned) || ticket !== reads.sessions) return;
      if (!Array.isArray(data.sessions) || data.sessions.some(session => !session || !/^[A-Za-z0-9_-]{1,128}$/.test(String(session.id)))) throw new Error('The session register could not be verified.');
      knownSessions = data.sessions.map(session => ({ ...session, id: String(session.id) })); sessionsLoaded = true;
      node.innerHTML = knownSessions.map(session => {
        const seen = new Date(session.last_seen_at), date = Number.isFinite(seen.getTime()) ? seen.toLocaleString() : 'Not available';
        return `<article><strong>${session.current ? 'Current session' : 'Active session'}</strong><p>${escapeHtml(session.user_agent || 'Unknown device')}</p><small>Last activity: ${escapeHtml(date)}</small>${session.current ? '' : `<button class="button button-secondary revoke-session" type="button" data-id="${escapeHtml(session.id)}">Sign out</button>`}</article>`;
      }).join('') || '<p>No active sessions.</p>';
      status.textContent = `${knownSessions.length} active ${knownSessions.length === 1 ? 'session' : 'sessions'}.`;
      for (const [key, held] of uncertain) {
        if (Array.isArray(held.sessionIds) && (held.sessionIds.length || knownSessions.every(session => session.current)) &&
            held.sessionIds.every(id => !knownSessions.some(session => session.id === id))) {
          uncertain.delete(key); holdButtons(held.form, held.button, false); showStatus('The selected session sign-out is confirmed by the current session register.', true);
        }
      }
    } catch (error) {
      if (!current(owned) || ticket !== reads.sessions || error.auth) return;
      status.textContent = knownSessions.length ? 'Last loaded sessions shown. Refresh failed; retry to confirm the current register.' : 'Active sessions unavailable. Retry to load the current register.';
      byId('retrySessionsBtn').hidden = false;
    } finally { if (current(owned) && ticket === reads.sessions) node.setAttribute('aria-busy', 'false'); }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.revoke-session'); if (!button) return;
    const id = String(button.dataset.id || ''), session = knownSessions.find(item => item.id === id && !item.current); if (!session) return;
    writeAction({ key: 'session:' + id, button, url: '/api/auth/sessions/' + encodeURIComponent(id), method: 'DELETE', hold: { sessionIds: [id] }, accepted: () => {
      ++reads.sessions; knownSessions = knownSessions.filter(item => item.id !== id); button.closest('article')?.remove();
      showStatus('The selected session was signed out.', true); loadSessions();
    } });
  });
  byId('revokeOthers').addEventListener('click', () => writeAction({ key: 'otherSessions', button: byId('revokeOthers'), url: '/api/auth/sessions/revoke-others',
    hold: { sessionIds: sessionsLoaded ? knownSessions.filter(session => !session.current).map(session => session.id) : undefined }, accepted: () => { ++reads.sessions; showStatus('Other sessions were signed out. Your current device remains signed in.', true); loadSessions(); } }));
  byId('changePasswordForm').addEventListener('submit', event => { event.preventDefault(); writeAction({ key: 'password', form: byId('changePasswordForm'), url: '/api/auth/change-password',
    body: { current_password: byId('currentPassword').value, new_password: byId('newPassword').value }, accepted: () => {
      byId('currentPassword').value = ''; byId('newPassword').value = ''; showStatus('Password changed. Sign in again to continue.', true);
      setTimeout(() => location.replace('/login?returnTo=%2Fsecurity'), 1000);
    } }); });
  byId('mfaStartForm').addEventListener('submit', event => { event.preventDefault(); writeAction({ key: 'mfaStart', form: byId('mfaStartForm'), url: '/api/auth/mfa/enroll/start',
    body: { current_password: byId('mfaPassword').value }, accepted: data => {
      if (typeof data.qr_code !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qr_code) || !/^[A-Z2-7]{16,128}$/i.test(data.manual_key || '')) throw Object.assign(new Error('Authenticator setup response is incomplete.'), { uncertain: true });
      byId('mfaSetup').hidden = false; byId('mfaQr').src = data.qr_code; byId('mfaManual').value = data.manual_key; byId('mfaPassword').value = '';
      showStatus('Scan the code and confirm setup. MFA is not enabled until the confirmation is saved.', true);
    } }); });
  byId('mfaConfirmForm').addEventListener('submit', event => {
    event.preventDefault(); const code = byId('mfaConfirmCode').value;
    if (!/^[0-9]{6}$/.test(code)) return foreground('Enter the six-digit code from your authenticator.', byId('mfaConfirmCode'));
    writeAction({ key: 'mfaConfirm', form: byId('mfaConfirmForm'), url: '/api/auth/mfa/enroll/confirm', body: { code }, accepted: data => {
      if (!Array.isArray(data.recovery_codes) || !data.recovery_codes.length || data.recovery_codes.some(value => typeof value !== 'string' || !value.trim())) throw Object.assign(new Error('Recovery-code response is incomplete.'), { uncertain: true });
      ++reads.mfa; byId('newRecovery').hidden = false; byId('newRecoveryCodes').textContent = data.recovery_codes.join('\n');
      byId('mfaSetup').hidden = true; byId('mfaStartForm').hidden = true; byId('mfaConfirmCode').value = ''; byId('mfaManual').value = ''; byId('mfaQr').removeAttribute('src');
      byId('mfaStatus').textContent = `Enabled · ${data.recovery_codes.length} recovery codes generated. Sign in again after saving them.`;
      // This endpoint revokes every prior session. Do not immediately issue an
      // authenticated read: its expected 401 would erase the one-time codes
      // before the employee can save them. Continue is an explicit user action.
      byId('refreshSecurityBtn').disabled = true;
      showStatus('Authenticator enabled. Save the displayed one-time recovery codes privately, then continue to sign in.', true);
    } });
  });
  byId('retryMfaBtn').addEventListener('click', loadMfaStatus); byId('retrySessionsBtn').addEventListener('click', loadSessions);
  byId('refreshSecurityBtn').addEventListener('click', () => { loadMfaStatus(); loadSessions(); });
  // Integrate with the existing managed native Back contract. Native input
  // tracking resets on submit, but a rejected/uncertain security action still
  // owns entered values. One-time recovery codes also need an explicit leave.
  byId('mfaStartForm').nativeHasUnsavedChanges = () => Boolean(byId('mfaPassword').value || pending.has('mfaStart') || uncertain.has('mfaStart'));
  byId('mfaConfirmForm').nativeHasUnsavedChanges = () => Boolean(byId('mfaConfirmCode').value || !byId('mfaSetup').hidden ||
    (!byId('newRecovery').hidden && !recoverySaved) || pending.has('mfaConfirm') || uncertain.has('mfaConfirm'));
  byId('changePasswordForm').nativeHasUnsavedChanges = () => Boolean(byId('currentPassword').value || byId('newPassword').value || pending.has('password') || uncertain.has('password'));
  byId('recoveryContinue').addEventListener('click', () => { recoverySaved = true; });
  function resetAccount() {
    displayedAccount = account(); ++epoch; ++reads.mfa; ++reads.sessions; knownSessions = []; sessionsLoaded = false; recoverySaved = false; uncertain.clear(); pending.clear();
    for (const id of ['mfaStartForm','mfaConfirmForm','changePasswordForm']) {
      formBusy(byId(id), false); delete byId(id).dataset.nativeRequestState;
    }
    byId('revokeOthers').disabled = false;
    byId('refreshSecurityBtn').disabled = false;
    for (const id of ['mfaPassword','mfaConfirmCode','mfaManual','currentPassword','newPassword']) byId(id).value = '';
    byId('mfaQr').removeAttribute('src'); byId('newRecoveryCodes').textContent = ''; byId('newRecovery').hidden = true; byId('mfaSetup').hidden = true;
    byId('sessions').innerHTML = ''; byId('status').textContent = ''; loadMfaStatus(); loadSessions();
  }
  window.addEventListener('pageshow', event => {
    if (displayedAccount !== account()) resetAccount();
    else if (event.persisted && byId('newRecovery').hidden) { loadMfaStatus(); loadSessions(); }
  });
  window.addEventListener('storage', event => { if (event.key === 'user' && displayedAccount !== account()) resetAccount(); });
  loadSessions(); loadMfaStatus();
})();
