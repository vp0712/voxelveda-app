(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  let verificationPromise = null;

  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'type') node.type = value;
      else node.setAttribute(key, value);
    });
    if (text) node.textContent = text;
    return node;
  }

  function ensureUi() {
    if (!document.getElementById('financeReliabilityStyle')) {
      const style = el('style', { id: 'financeReliabilityStyle' });
      style.textContent = `
        #financeActionToast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:10050;max-width:min(680px,calc(100vw - 28px));padding:12px 16px;border-radius:12px;background:#111827;color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.28);font:600 14px/1.45 system-ui,-apple-system,sans-serif;display:none}
        #financeActionToast.show{display:block}#financeActionToast.error{background:#7f1d1d}#financeActionToast.success{background:#14532d}#financeActionToast.warning{background:#78350f}
        #financeStepUpDialog{border:0;border-radius:18px;padding:0;width:min(520px,calc(100vw - 28px));box-shadow:0 24px 80px rgba(0,0,0,.38)}
        #financeStepUpDialog::backdrop{background:rgba(15,23,42,.68);backdrop-filter:blur(4px)}
        .fsu{padding:22px}.fsu h2{margin:0 0 7px;font:750 24px/1.15 system-ui}.fsu p{margin:0 0 16px;color:#475569;font:14px/1.5 system-ui}.fsu label{display:block;margin:13px 0 5px;font:700 13px system-ui;color:#334155}.fsu input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font:16px system-ui}.fsu .row{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}.fsu button{border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:10px 14px;font-weight:700}.fsu button.primary{background:#111827;color:#fff;border-color:#111827}.fsu button:disabled{opacity:.55}.fsu .err{min-height:20px;color:#b91c1c;margin-top:10px;font:600 13px system-ui}.fsu .safe{background:#f8fafc;border-radius:10px;padding:10px 12px;color:#475569;font:12px/1.45 system-ui;margin-top:12px}
        .finance-busy{pointer-events:none!important;opacity:.68!important}
      `;
      document.head.appendChild(style);
    }
    if (!document.getElementById('financeActionToast')) document.body.appendChild(el('div', { id: 'financeActionToast', role: 'status', 'aria-live': 'polite' }));
    if (!document.getElementById('financeStepUpDialog')) {
      const dialog = el('dialog', { id: 'financeStepUpDialog' });
      dialog.innerHTML = `<form class="fsu" id="financeStepUpForm">
        <h2>Security check</h2>
        <p>This action changes sensitive finance or banking information. Verify once and continue; the verification remains valid for a short period.</p>
        <label for="fsuPassword">Your Voxel Veda password</label>
        <input id="fsuPassword" name="password" type="password" autocomplete="current-password" required>
        <label for="fsuCode">6-digit authenticator code</label>
        <input id="fsuCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000">
        <div class="safe">Use your Voxel Veda login password and authenticator-app code. Never enter your bank password, bank PIN or bank OTP here.</div>
        <div class="err" id="fsuError" aria-live="assertive"></div>
        <div class="row"><button type="button" id="fsuCancel">Cancel</button><button class="primary" type="submit" id="fsuSubmit">Verify & continue</button></div>
      </form>`;
      document.body.appendChild(dialog);
    }
  }

  function toast(message, tone = 'info', timeout = 5000) {
    ensureUi();
    const host = document.getElementById('financeActionToast');
    host.textContent = String(message || '');
    host.className = `show ${tone}`;
    window.clearTimeout(host._timer);
    host._timer = window.setTimeout(() => { host.className = ''; }, timeout);
  }

  function verificationDialog() {
    if (verificationPromise) return verificationPromise;
    ensureUi();
    const dialog = document.getElementById('financeStepUpDialog');
    const form = document.getElementById('financeStepUpForm');
    const errorBox = document.getElementById('fsuError');
    const submit = document.getElementById('fsuSubmit');
    const cancel = document.getElementById('fsuCancel');
    form.reset(); errorBox.textContent = '';

    verificationPromise = new Promise((resolve, reject) => {
      const finish = (ok, error) => {
        form.removeEventListener('submit', onSubmit);
        cancel.removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        if (dialog.open) dialog.close();
        verificationPromise = null;
        ok ? resolve(true) : reject(error || Object.assign(new Error('Security verification was cancelled.'), { code: 'STEP_UP_CANCELLED' }));
      };
      const onCancel = (event) => { event?.preventDefault?.(); finish(false); };
      const onSubmit = async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        submit.disabled = true; submit.textContent = 'Verifying…'; errorBox.textContent = '';
        try {
          const payload = Object.fromEntries(new FormData(form).entries());
          const response = await originalFetch('/api/auth/step-up', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          let data = {}; try { data = await response.json(); } catch {}
          if (!response.ok) throw Object.assign(new Error(data.message || 'Security verification failed.'), { code: data.code, status: response.status });
          toast(data.message || 'Security verification complete.', 'success', 3000);
          finish(true);
        } catch (error) {
          errorBox.textContent = error.message || 'Security verification failed.';
          if (error.code === 'MFA_SETUP_REQUIRED') errorBox.textContent += ' Open your account security settings and set up Authenticator MFA first.';
        } finally {
          submit.disabled = false; submit.textContent = 'Verify & continue';
        }
      };
      form.addEventListener('submit', onSubmit);
      cancel.addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
      window.setTimeout(() => document.getElementById('fsuPassword')?.focus(), 40);
    });
    return verificationPromise;
  }

  async function maybeStepUp(response, input, init) {
    if (response.status !== 403) return response;
    let payload = null;
    try { payload = await response.clone().json(); } catch {}
    if (payload?.code !== 'STEP_UP_REQUIRED') return response;
    await verificationDialog();
    return originalFetch(input, init);
  }

  window.fetch = async function financeReliableFetch(input, init = {}) {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = String(input instanceof Request ? input.url : input || '');
    const response = await originalFetch(input, init);
    if (!MUTATING.has(method) || url.includes('/api/auth/step-up')) return response;
    try { return await maybeStepUp(response, input, init); }
    catch (error) {
      if (error?.code !== 'STEP_UP_CANCELLED') toast(error.message || 'Action could not continue.', 'error');
      return response;
    }
  };

  function mirrorNotice(node) {
    if (!node || node.hidden || !String(node.textContent || '').trim()) return;
    const cls = String(node.className || '');
    const tone = cls.includes('error') ? 'error' : cls.includes('success') ? 'success' : cls.includes('warning') ? 'warning' : 'info';
    toast(node.textContent.trim(), tone);
  }

  function observeNotices() {
    ['notice', 'advancedNotice'].forEach((id) => {
      const node = document.getElementById(id);
      if (!node) return;
      const observer = new MutationObserver(() => mirrorNotice(node));
      observer.observe(node, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    });
  }

  function installActionGuards() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
        const invalid = form.querySelector(':invalid');
        invalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        invalid?.focus?.();
        toast('Please complete the highlighted required field before continuing.', 'warning');
      }
    }, true);

    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.id === 'importStatement') {
        const select = document.getElementById('importAccount');
        if (!select || !select.options.length) {
          event.preventDefault(); event.stopImmediatePropagation();
          toast('Add a financial account first. Then import the statement into that account.', 'warning', 6500);
          document.getElementById('addAccount')?.click();
        }
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureUi();
    observeNotices();
    installActionGuards();
  });
})();
