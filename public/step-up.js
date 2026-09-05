(function () {
  const nativeFetch = window.fetch.bind(window);
  let verificationPromise = null;

  function actionLabel(value) {
    return String(value || 'HIGH_RISK_ACTION')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function ensureDialog() {
    let dialog = document.getElementById('stepUpDialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'stepUpDialog';
    dialog.className = 'step-up-backdrop';
    dialog.hidden = true;
    dialog.innerHTML = `
      <section class="step-up-panel" role="dialog" aria-modal="true" aria-labelledby="stepUpTitle">
        <p class="step-up-eyebrow">SECURITY REVIEW</p>
        <h2 id="stepUpTitle">Security Verification Required</h2>
        <p>This is a high-risk operation. Confirm your password and authenticator code before continuing.</p>
        <dl class="step-up-review">
          <div><dt>Action</dt><dd id="stepUpAction">High Risk Action</dd></div>
          <div><dt>Permission</dt><dd>Granted by server</dd></div>
          <div><dt>Recent verification</dt><dd class="step-up-required">Required</dd></div>
        </dl>
        <form id="stepUpForm">
          <label><span>Current password</span><input id="stepUpPassword" type="password" autocomplete="current-password" required></label>
          <label><span>Authenticator code</span><input id="stepUpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
          <p id="stepUpStatus" class="step-up-status" role="status"></p>
          <div class="step-up-actions">
            <button type="button" class="step-up-cancel">Cancel</button>
            <button type="submit" class="step-up-confirm">Verify and Continue</button>
          </div>
        </form>
      </section>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function requestVerification(action) {
    if (verificationPromise) return verificationPromise;
    verificationPromise = new Promise((resolve) => {
      const dialog = ensureDialog();
      const form = dialog.querySelector('#stepUpForm');
      const password = dialog.querySelector('#stepUpPassword');
      const code = dialog.querySelector('#stepUpCode');
      const status = dialog.querySelector('#stepUpStatus');
      const confirm = dialog.querySelector('.step-up-confirm');
      dialog.querySelector('#stepUpAction').textContent = actionLabel(action);
      status.textContent = '';
      password.value = '';
      code.value = '';
      dialog.hidden = false;
      setTimeout(() => password.focus(), 0);

      const finish = (result) => {
        dialog.hidden = true;
        password.value = '';
        code.value = '';
        form.removeEventListener('submit', submit);
        dialog.querySelector('.step-up-cancel').removeEventListener('click', cancel);
        verificationPromise = null;
        resolve(result);
      };
      const cancel = () => finish(false);
      const submit = async (event) => {
        event.preventDefault();
        confirm.disabled = true;
        status.textContent = 'Verifying…';
        try {
          const response = await nativeFetch('/api/auth/step-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.value, code: code.value })
          });
          const data = await response.json().catch(() => ({}));
          if (response.status === 401) {
            window.location.assign('/login?message=Your%20session%20has%20ended');
            return;
          }
          if (data.code === 'MFA_SETUP_REQUIRED') {
            window.location.assign('/security?mfa_setup=required');
            return;
          }
          if (!response.ok) {
            status.textContent = data.message || 'Security verification failed.';
            code.value = '';
            code.focus();
            return;
          }
          finish(true);
        } catch {
          status.textContent = 'Verification could not reach the server. Try again.';
        } finally {
          confirm.disabled = false;
        }
      };
      form.addEventListener('submit', submit);
      dialog.querySelector('.step-up-cancel').addEventListener('click', cancel);
    });
    return verificationPromise;
  }

  window.fetch = async function stepUpAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/step-up') || response.status !== 403) return response;
    const body = await response.clone().json().catch(() => ({}));
    if (body.code !== 'STEP_UP_REQUIRED') return response;
    const verified = await requestVerification(body.action);
    if (!verified) return response;
    if (typeof input !== 'string') return response;
    return nativeFetch(input, init);
  };

  window.stepUpSecurity = { verify: requestVerification };
})();
