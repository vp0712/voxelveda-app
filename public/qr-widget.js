(function () {
  if (window.__voxelQrWidgetInstalled) return;
  window.__voxelQrWidgetInstalled = true;
  const LIVE_APP_ORIGIN = 'https://voxelveda-app-production.up.railway.app';

  function qrTarget() {
    return `${LIVE_APP_ORIGIN}/customer.html`;
  }

  function qrImageUrl(target) {
    return `/api/qr?data=${encodeURIComponent(target)}&v=20260608-local-qr`;
  }

  function closeQrWidget(event) {
    if (event && event.target?.id !== 'globalQrBackdrop') return;
    document.getElementById('globalQrBackdrop')?.classList.remove('active');
  }

  function openQrWidget() {
    const target = qrTarget();
    document.getElementById('globalQrImage').src = qrImageUrl(target);
    document.getElementById('globalQrUrl').textContent = target;
    document.getElementById('globalQrDownload').href = qrImageUrl(target);
    document.getElementById('globalQrOpen').href = target;
    document.getElementById('globalQrBackdrop')?.classList.add('active');
  }

  function install() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button type="button" class="global-qr-button" aria-label="Open Voxel Veda QR code">
        <span>QR</span>
      </button>
      <div id="globalQrBackdrop" class="global-qr-backdrop" role="dialog" aria-modal="true">
        <section class="global-qr-panel">
          <button type="button" class="global-qr-close" aria-label="Close QR code">x</button>
          <h3>Voxel Veda QR Access</h3>
          <p>Scan to open the customer RFQ form.</p>
          <div class="branded-qr-frame">
            <img id="globalQrImage" alt="Voxel Veda QR code" />
          </div>
          <div class="qr-brand-strip">
            <img src="/Frame 1.png?v=20260601-clean-logo" alt="Voxel Veda" />
            <span>Scan-safe access code</span>
          </div>
          <p id="globalQrUrl" class="global-qr-url"></p>
          <div class="card-actions">
            <a id="globalQrOpen" class="secondary-btn" href="/customer.html" target="_blank" rel="noopener">Open</a>
            <a id="globalQrDownload" class="primary-btn" href="#" download="voxel-veda-rfq-qr.png">Download QR</a>
          </div>
        </section>
      </div>
    `;

    document.body.appendChild(wrap);
    document.querySelector('.global-qr-button')?.addEventListener('click', openQrWidget);
    document.querySelector('.global-qr-close')?.addEventListener('click', () => closeQrWidget({ target: { id: 'globalQrBackdrop' } }));
    document.getElementById('globalQrBackdrop')?.addEventListener('click', closeQrWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
