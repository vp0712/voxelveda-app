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
        <p>Enter your current password and authenticator code to continue.</p>
        <dl class="step-up-review">
          <div><dt>Action</dt><dd id="stepUpAction">High Risk Action</dd></div>
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
      const returnFocus=document.activeElement;
      const savedOverflow=document.body.style.overflow;
      document.body.style.overflow='hidden';
      const resumeLoader=window.VoxelVedaBrandLoader?.suspend?.();
      const viewport=window.visualViewport;
      const fitViewport=()=>{dialog.style.setProperty('--step-up-height',`${viewport?.height||innerHeight}px`);dialog.style.top=`${viewport?.offsetTop||0}px`;};
      fitViewport();
      viewport?.addEventListener('resize',fitViewport);
      viewport?.addEventListener('scroll',fitViewport);
      window.addEventListener('resize',fitViewport);
      let finished=false;
      dialog.querySelector('#stepUpAction').textContent = actionLabel(action);
      status.textContent = '';
      password.value = '';
      code.value = '';
      dialog.hidden = false;
      setTimeout(() => password.focus(), 0);

      const finish = (result) => {
        if(finished)return;finished=true;
        dialog.hidden = true;
        password.value = '';
        code.value = '';
        form.removeEventListener('submit', submit);
        dialog.querySelector('.step-up-cancel').removeEventListener('click', cancel);
        document.removeEventListener('keydown',keyboard,true);
        viewport?.removeEventListener('resize',fitViewport);
        viewport?.removeEventListener('scroll',fitViewport);
        window.removeEventListener('resize',fitViewport);
        resumeLoader?.();
        document.body.style.overflow=savedOverflow;
        verificationPromise = null;
        if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
        resolve(result);
      };
      const cancel = () => finish(false);
      const keyboard=event=>{if(dialog.hidden)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!confirm.disabled)finish(false);}else if(event.key==='Tab'){event.stopImmediatePropagation();const controls=[...dialog.querySelectorAll('input,button')].filter(n=>!n.disabled&&n.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
      document.addEventListener('keydown',keyboard,true);
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
            const returnTo=window.location.pathname+window.location.search+window.location.hash;
            window.location.assign('/login?returnTo='+encodeURIComponent(returnTo)+'&message=Your%20session%20has%20ended');
            return;
          }
          if (data.code === 'MFA_SETUP_REQUIRED') {
            window.location.assign('/security?mfa_setup=required');
            return;
          }
          if (!response.ok || Number(data.assurance_level)!==3) {
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
