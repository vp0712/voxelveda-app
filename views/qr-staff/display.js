'use strict';
(() => {
  const code = new URLSearchParams(location.hash.slice(1)).get('code');
  if (code && /^[A-Za-z0-9_-]{43}$/.test(code)) {
    location.replace('/setup#' + new URLSearchParams({ code }));
    return;
  }

  const rotationMs = 30000;
  const retryMs = 3000;
  let image = document.getElementById('attendance-qr');
  let nextRefresh;
  let refreshing = false;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    clearTimeout(nextRefresh);
    let delay = retryMs;
    try {
      const response = await fetch('/qr-staff/current', {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('Attendance QR unavailable.');
      const { image_url, expires_at, server_time } = await response.json();
      const receivedAt = performance.now();
      const validFor = Date.parse(expires_at) - Date.parse(server_time);
      if (typeof image_url !== 'string' || !image_url || !(validFor > 0)) throw new Error('Invalid attendance QR.');
      const url = new URL(image_url, location.origin);
      if (url.origin !== location.origin) throw new Error('Invalid attendance QR origin.');

      if (image.src !== url.href) {
        const replacement = image.cloneNode();
        replacement.src = url.href;
        await replacement.decode();
        image.replaceWith(replacement);
        image = replacement;
      }
      delay = Math.min(rotationMs, Math.max(250, validFor - (performance.now() - receivedAt)));
    } catch {
      // Keep the last loaded image visible while retrying a failed refresh.
    } finally {
      refreshing = false;
      nextRefresh = setTimeout(refresh, delay);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  refresh();
})();
