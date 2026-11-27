'use strict';
(() => {
  const code = new URLSearchParams(location.hash.slice(1)).get('code');
  if (code && /^[A-Za-z0-9_-]{43}$/.test(code)) {
    location.replace('/setup#' + new URLSearchParams({ code }));
  }
})();
