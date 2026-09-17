'use strict';

(() => {
  const loader = document.getElementById('vvGlobalBrandLoader');
  if (!loader) return;

  const body = document.body;
  let active = 1; // initial document load
  let hideTimer = null;
  let failSafeTimer = null;

  function setVisible(visible) {
    if (visible) {
      clearTimeout(hideTimer);
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
    hideTimer = setTimeout(() => {
      loader.classList.remove('is-visible');
      loader.setAttribute('aria-hidden', 'true');
      body?.classList.remove('vv-brand-busy');
    }, 90);
  }

  function begin() {
    active += 1;
    setVisible(true);
    return () => end();
  }

  function end() {
    active = Math.max(0, active - 1);
    if (active === 0) setVisible(false);
  }

  function finishInitialLoad() {
    if (active > 0) end();
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

  // Keep the exact original artwork as the source everywhere we recognize an older alias.
  document.querySelectorAll('img').forEach((img) => {
    const src = String(img.getAttribute('src') || '');
    if (/\/(?:voxel-veda-logo|Frame(?:%20| )1|og-image)\.png(?:[?#].*)?$/i.test(src)) {
      img.setAttribute('src', '/logo.png');
    }
  });

  // Page-to-page navigation: show the original logo immediately and keep it centered until the next page is ready.
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank' || anchor.dataset.brandLoader === 'off') return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || shouldIgnoreUrl(href)) return;
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.href !== window.location.href) begin();
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.brandLoader === 'off' || form.target === '_blank') return;
    begin();
  }, true);

  // Fetch/XHR waits longer than a brief paint get the centered brand screen. This avoids flashing for instant background calls.
  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = async (...args) => {
      const rawUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (shouldIgnoreUrl(rawUrl || '')) return nativeFetch(...args);
      let release = null;
      const timer = setTimeout(() => { release = begin(); }, 180);
      try {
        return await nativeFetch(...args);
      } finally {
        clearTimeout(timer);
        if (release) release();
      }
    };
  }

  if (window.XMLHttpRequest) {
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__vvBrandUrl = url;
      return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (shouldIgnoreUrl(this.__vvBrandUrl || '')) return nativeSend.apply(this, args);
      let release = null;
      const timer = setTimeout(() => { release = begin(); }, 180);
      this.addEventListener('loadend', () => {
        clearTimeout(timer);
        if (release) release();
      }, { once: true });
      return nativeSend.apply(this, args);
    };
  }

  window.VoxelVedaBrandLoader = Object.freeze({ begin, end, show: () => begin() });
  window.addEventListener('load', finishInitialLoad, { once: true });
  window.addEventListener('pageshow', () => {
    active = 0;
    setVisible(false);
  });

  if (document.readyState === 'complete') finishInitialLoad();
  else setVisible(true);
})();
