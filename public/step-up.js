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

// Load the controlled QMS/facility form catalogue only on the authenticated admin UI.
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('companyFormsSection') || document.querySelector('script[data-controlled-forms]')) return;
  const script = document.createElement('script');
  script.src = '/controlled-forms.js?v=20260908-controlled-packs-r1';
  script.defer = true;
  script.dataset.controlledForms = 'true';
  document.head.appendChild(script);
});

// Universal profile entry points for authenticated admin and staff portals.
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.sidebar-nav');
  const footer = document.querySelector('.sidebar-footer');
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  const profileChip = document.querySelector('.profile-chip');

  const openProfile = (event) => {
    event?.preventDefault?.();
    window.location.assign('/profile');
  };

  if (profileChip) {
    profileChip.onclick = openProfile;
    profileChip.setAttribute('aria-label', 'Open My Profile');
    profileChip.title = 'My Profile';
  }

  if (sidebar && !sidebar.querySelector('[data-my-profile-link]')) {
    const existingLegacyProfile = sidebar.querySelector('[data-section="profileSection"]');
    if (existingLegacyProfile) {
      existingLegacyProfile.dataset.myProfileLink = 'true';
      existingLegacyProfile.removeAttribute('data-section');
      existingLegacyProfile.textContent = 'My Profile';
      existingLegacyProfile.addEventListener('click', openProfile);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-btn';
      button.dataset.myProfileLink = 'true';
      button.dataset.icon = 'ME';
      button.dataset.title = 'My Profile';
      button.textContent = 'My Profile';
      button.addEventListener('click', openProfile);
      const companyLabel = Array.from(sidebar.querySelectorAll('.nav-section-label')).find((node) => node.textContent.trim() === 'Company');
      if (companyLabel?.nextSibling) sidebar.insertBefore(button, companyLabel.nextSibling);
      else sidebar.appendChild(button);
    }
  }

  if (footer && !footer.querySelector('[data-my-profile-footer]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'logout-btn';
    button.dataset.myProfileFooter = 'true';
    button.textContent = 'My Profile';
    button.style.marginBottom = '8px';
    button.addEventListener('click', openProfile);
    footer.prepend(button);
  }

  if (mobileNav && !mobileNav.querySelector('[data-my-profile-mobile]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-btn';
    button.dataset.myProfileMobile = 'true';
    button.textContent = 'Profile';
    button.addEventListener('click', openProfile);
    mobileNav.appendChild(button);
  }
});
