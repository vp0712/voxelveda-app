'use strict';

(() => {
  const CANONICAL_LOGO = '/logo.png';
  const loader = document.getElementById('vvGlobalBrandLoader');
  if (!loader || window.__vvGlobalBrandLoaderInstalled) return;
  window.__vvGlobalBrandLoaderInstalled = true;

  const body = document.body;
  const contextNode = document.getElementById('vvGlobalBrandLoaderContext');
  let active = 0;
  let showTimer = null;
  let hideTimer = null;
  let failSafeTimer = null;
  let visibleSince = 0;
  let currentContext = 'Loading securely…';
  const MIN_VISIBLE_MS = 520;
  const API_DELAY_MS = 520;
  const NAV_DELAY_MS = 80;
  const FAIL_SAFE_MS = 30000;
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const NativeXHR = window.XMLHttpRequest;

  function setContext(message) {
    const value = String(message || '').trim() || 'Loading securely…';
    currentContext = value;
    if (contextNode) contextNode.textContent = value;
  }

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
      }, FAIL_SAFE_MS);
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
      setContext('Loading securely…');
    }, wait);
  }

  function begin({ delay = API_DELAY_MS, context = 'Loading securely…' } = {}) {
    active += 1;
    setContext(context);
    if (!loader.classList.contains('is-visible')) {
      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        if (active > 0) setVisible(true);
      }, Math.max(0, Number(delay) || 0));
    }

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

  function hideAll() {
    active = 0;
    clearTimeout(showTimer);
    setVisible(false);
  }

  function shouldIgnoreUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return true;
      if (/\/(api\/health|api\/ready|favicon(?:-|\.|\/)|service-worker\.js)/i.test(url.pathname)) return true;
      if (/\/api\/(notifications(?:\/|$)|public\/shift-qr(?:\/|$))/i.test(url.pathname)) return true;
      if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|map)(?:$|\?)/i.test(url.pathname + url.search)) return true;
      return false;
    } catch {
      return false;
    }
  }

  function requestUrl(input) {
    if (typeof input === 'string' || input instanceof URL) return String(input);
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    return '';
  }

  function requestMethod(input, init) {
    if (init?.method) return String(init.method).toUpperCase();
    if (typeof Request !== 'undefined' && input instanceof Request) return String(input.method || 'GET').toUpperCase();
    return 'GET';
  }

  function contextForRequest(urlValue, method = 'GET') {
    const methodName = String(method || 'GET').toUpperCase();
    const path = (() => {
      try { return new URL(urlValue, window.location.href).pathname.toLowerCase(); } catch { return ''; }
    })();
    if (/statement|import|upload/.test(path)) return 'Processing your file securely…';
    if (/finance|expense|invoice|payment|bank/.test(path)) return methodName === 'GET' ? 'Refreshing finance data…' : 'Saving finance changes…';
    if (/security|auth|mfa/.test(path)) return 'Verifying securely…';
    if (/dashboard|report|analytics|insight/.test(path)) return 'Refreshing your workspace…';
    if (methodName === 'GET') return 'Refreshing data…';
    if (methodName === 'DELETE') return 'Updating records securely…';
    return 'Saving changes…';
  }

  function shouldTrackRequest(urlValue, method = 'GET') {
    if (!urlValue || shouldIgnoreUrl(urlValue)) return false;
    try {
      const url = new URL(urlValue, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (!url.pathname.startsWith('/api/')) return false;
      return String(method || 'GET').toUpperCase() !== 'HEAD';
    } catch {
      return false;
    }
  }

  function isHistoricalLogo(src) {
    const value = String(src || '').trim();
    return /(?:voxel-veda-logo|Frame(?:%20| )1|og-image)\.png/i.test(value)
      || /^\/\/logo\.png/i.test(value)
      || /\/logo\.png(?:[?#]|$)/i.test(value);
  }

  function canonicalizeLogo(img) {
    if (!(img instanceof HTMLImageElement)) return;
    const raw = String(img.getAttribute('src') || '');
    if (!isHistoricalLogo(raw)) return;
    if (raw !== CANONICAL_LOGO) img.setAttribute('src', CANONICAL_LOGO);
    img.style.objectFit = 'contain';
    img.style.objectPosition = 'center';
  }

  document.querySelectorAll('img').forEach((img) => {
    canonicalizeLogo(img);
    img.addEventListener('error', () => {
      if (isHistoricalLogo(img.getAttribute('src')) && img.getAttribute('src') !== CANONICAL_LOGO) {
        img.setAttribute('src', CANONICAL_LOGO);
      }
    });
  });

  const logoObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('img')) canonicalizeLogo(node);
        node.querySelectorAll?.('img').forEach(canonicalizeLogo);
      });
    });
  });
  logoObserver.observe(document.documentElement, { childList: true, subtree: true });

  if (nativeFetch) {
    window.fetch = function voxelVedaTrackedFetch(input, init) {
      const urlValue = requestUrl(input);
      const method = requestMethod(input, init);
      if (!shouldTrackRequest(urlValue, method)) return nativeFetch(input, init);
      const release = begin({ delay: API_DELAY_MS, context: contextForRequest(urlValue, method) });
      try {
        return nativeFetch(input, init).finally(release);
      } catch (error) {
        release();
        throw error;
      }
    };
  }

  if (typeof NativeXHR === 'function') {
    const open = NativeXHR.prototype.open;
    const send = NativeXHR.prototype.send;
    NativeXHR.prototype.open = function vvTrackedOpen(method, url, ...rest) {
      this.__vvLoaderMethod = String(method || 'GET').toUpperCase();
      this.__vvLoaderUrl = String(url || '');
      return open.call(this, method, url, ...rest);
    };
    NativeXHR.prototype.send = function vvTrackedSend(...args) {
      let release = null;
      if (shouldTrackRequest(this.__vvLoaderUrl, this.__vvLoaderMethod)) {
        release = begin({ delay: API_DELAY_MS, context: contextForRequest(this.__vvLoaderUrl, this.__vvLoaderMethod) });
        this.addEventListener('loadend', release, { once: true });
      }
      try {
        return send.apply(this, args);
      } catch (error) {
        release?.();
        throw error;
      }
    };
  }

  const finishInitial = begin({ delay: 0, context: 'Preparing your workspace…' });
  if (document.readyState === 'complete') window.setTimeout(finishInitial, 120);
  else window.addEventListener('load', () => window.setTimeout(finishInitial, 80), { once: true });

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank' || anchor.dataset.brandLoader === 'off') return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || shouldIgnoreUrl(href)) return;
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.href !== window.location.href) {
      begin({ delay: NAV_DELAY_MS, context: 'Opening your workspace…' });
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.brandLoader === 'off' || form.target === '_blank') return;
    window.setTimeout(() => {
      if (!event.defaultPrevented) begin({ delay: NAV_DELAY_MS, context: 'Submitting securely…' });
    }, 0);
  });

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
    hideAll();
    showNetworkStatus('You’re offline. Your current screen will stay open.', true, 0);
  });

  window.addEventListener('online', () => {
    showNetworkStatus('Back online. Updating in the background…', false, 2400);
    window.dispatchEvent(new CustomEvent('voxelveda:network-restored'));
  });

  if (!navigator.onLine) showNetworkStatus('You’re offline. Your current screen will stay open.', true, 0);

  window.addEventListener('voxelveda:loader-start', (event) => {
    const detail = event.detail || {};
    const release = begin({ delay: Number(detail.delay ?? API_DELAY_MS), context: detail.context || 'Loading securely…' });
    if (detail.token && typeof detail.token === 'object') detail.token.release = release;
  });
  window.addEventListener('voxelveda:loader-stop', hideAll);

  window.VoxelVedaBrandLoader = Object.freeze({
    begin,
    hide: hideAll,
    show(context = 'Loading securely…') { return begin({ delay: 0, context }); },
    async withPromise(promise, options = {}) {
      const release = begin(options);
      try { return await promise; } finally { release(); }
    },
    isVisible() { return loader.classList.contains('is-visible'); },
    context() { return currentContext; }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    hideAll();
  });
})();
