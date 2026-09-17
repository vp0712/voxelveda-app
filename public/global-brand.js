'use strict';

(() => {
  const loader = document.getElementById('vvGlobalBrandLoader');
  if (!loader) return;

  const body = document.body;
  let active = 0;
  let showTimer = null;
  let hideTimer = null;
  let failSafeTimer = null;
  let visibleSince = 0;
  const MIN_VISIBLE_MS = 700;
  const INITIAL_DELAY_MS = 260;

  function setVisible(visible) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (visible) {
      if (loader.classList.contains('is-visible')) return;
      visibleSince = Date.now();
      loader.classList.add('is-visible');
      loader.setAttribute('aria-hidden', 'false');
      body?.classList.add('vv-brand-busy');
      clearTimeout(failSafeTimer);
      failSafeTimer = setTimeout(() => {
        active = 0;
        setVisible(false);
      }, 15000);
      return;
    }
    clearTimeout(failSafeTimer);
    const elapsed = visibleSince ? Date.now() - visibleSince : MIN_VISIBLE_MS;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    hideTimer = setTimeout(() => {
      loader.classList.remove('is-visible');
      loader.setAttribute('aria-hidden', 'true');
      body?.classList.remove('vv-brand-busy');
      visibleSince = 0;
    }, wait);
  }

  function begin({ delay = 120 } = {}) {
    active += 1;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (active > 0) setVisible(true);
    }, delay);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      if (active === 0) {
        clearTimeout(showTimer);
        setVisible(false);
      }
    };
  }

  function shouldIgnoreUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return true;
      return /\/(api\/health|api\/ready|favicon(?:-|\.|\/)|service-worker\.js)/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  // Canonicalize only known legacy aliases to the byte-identical original company logo.
  document.querySelectorAll('img').forEach((img) => {
    const src = String(img.getAttribute('src') || '');
    if (/\/(?:voxel-veda-logo|Frame(?:%20| )1|og-image)\.png(?:[?#].*)?$/i.test(src)) img.setAttribute('src', '/logo.png');
  });

  // Initial page boot: delay the full-screen loader so fast loads never flash it.
  const finishInitial = begin({ delay: INITIAL_DELAY_MS });
  if (document.readyState === 'complete') finishInitial();
  else window.addEventListener('load', finishInitial, { once: true });

  // Only real document navigations use the full-screen loader. Background API work does not.
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank' || anchor.dataset.brandLoader === 'off') return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || shouldIgnoreUrl(href)) return;
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.href !== window.location.href) begin({ delay: 120 });
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.brandLoader === 'off' || form.target === '_blank') return;
    begin({ delay: 160 });
  }, true);

  // Network state is informational only. Never hard-reload or reopen the full-screen loader on reconnect.
  const status = document.createElement('div');
  status.className = 'vv-network-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  document.body.appendChild(status);
  let networkTimer = null;

  function showNetworkStatus(message, offline = false, duration = 2600) {
    clearTimeout(networkTimer);
    status.textContent = message;
    status.classList.toggle('is-offline', offline);
    status.classList.add('is-visible');
    if (duration > 0) networkTimer = setTimeout(() => status.classList.remove('is-visible'), duration);
  }

  window.addEventListener('offline', () => {
    showNetworkStatus('You’re offline. Your current screen will stay open.', true, 0);
  });

  window.addEventListener('online', () => {
    showNetworkStatus('Back online. Updating in the background…', false, 2400);
    // Let individual modules refresh on their own schedules. Do not reload the page here.
    window.dispatchEvent(new CustomEvent('voxelveda:network-restored'));
  });

  if (!navigator.onLine) showNetworkStatus('You’re offline. Your current screen will stay open.', true, 0);

  window.VoxelVedaBrandLoader = Object.freeze({ begin, hide: () => { active = 0; setVisible(false); } });
  window.addEventListener('pageshow', () => {
    active = 0;
    clearTimeout(showTimer);
    setVisible(false);
  });
})();
