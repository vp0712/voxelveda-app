(() => {
  'use strict';
  let active = null;
  let bodyState = null;
  function unlock() {
    if (!bodyState || !document.body) return;
    document.body.style.overflow = bodyState.overflow;
    document.body.style.overscrollBehavior = bodyState.overscroll;
    document.body.classList.remove('vv-overlay-open');
    bodyState = null;
  }
  function close(id, reason = 'closed') {
    if (!active || (id && active.id !== id)) return false;
    const previous = active;
    active = null;
    try { previous.onClose?.(reason); }
    finally {
      // A close callback may deliberately open another sheet.
      if (!active) unlock();
      window.dispatchEvent(new CustomEvent('vv:overlay-closed', { detail: { id: previous.id, reason } }));
      if (!active && reason !== 'replacement' && previous.returnFocus?.isConnected) previous.returnFocus.focus({ preventScroll: true });
    }
    return true;
  }
  function open(name, onClose, returnFocus) {
    const next = typeof name === 'string' ? { id: name, onClose, returnFocus } : { ...name };
    if (!next.id || typeof next.onClose !== 'function') throw new Error('An overlay needs an identity and a close action.');
    if (active?.id === next.id) return active.id;
    close(null, 'replacement');
    if (active) close(null, 'replacement');
    if (document.body?.classList.contains('mobile-menu-open')) {
      if (typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu(false);
      if (typeof window.toggleStaffMobileMenu === 'function') window.toggleStaffMobileMenu(false);
    }
    next.returnFocus ||= document.activeElement;
    active = next;
    if (document.body) {
      bodyState ||= { overflow: document.body.style.overflow, overscroll: document.body.style.overscrollBehavior };
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      document.body.classList.add('vv-overlay-open');
    }
    window.dispatchEvent(new CustomEvent('vv:overlay-open', { detail: { id: next.id } }));
    return next.id;
  }
  window.VoxelOverlay = { open, close, closeAll: () => close(), get active() { return active?.id || null; } };
  window.addEventListener('pagehide', () => close(null, 'navigation'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.preventDefault(); close(null, 'escape'); }
  });
  document.addEventListener('click', event => {
    const menu = event.target.closest?.('[data-mobile-menu-action]');
    if (menu && ['open', 'toggle'].includes(menu.dataset.mobileMenuAction)) close(null, 'navigation');
  }, true);
})();
