(() => {
  'use strict';
  let active = null;
  const suspended = [];
  let bodyState = null;
  function unlock() {
    if (!bodyState || !document.body) return;
    const saved = bodyState;
    document.body.style.overflow = saved.overflow;
    document.body.style.overscrollBehavior = saved.overscroll;
    document.body.classList.remove('vv-overlay-open');
    bodyState = null;
    window.scrollTo?.({ left: saved.scrollX, top: saved.scrollY, behavior: 'instant' });
  }
  function close(id, reason = 'closed') {
    if (!active || (id && active.id !== id)) return false;
    const previous = active;
    if(previous.beforeClose?.(reason)===false)return false;
    active = null;
    try { previous.onClose?.(reason); }
    finally {
      if (!active && suspended.length) {
        active = suspended.pop();
        if (active.root) { active.root.inert = active.savedInert || false; active.root.removeAttribute('aria-hidden'); }
      }
      // A close callback may deliberately open another sheet.
      if (!active) unlock();
      window.dispatchEvent(new CustomEvent('vv:overlay-closed', { detail: { id: previous.id, reason } }));
      if (reason !== 'replacement' && previous.returnFocus?.isConnected && (!active || suspended.length || previous.modal)) previous.returnFocus.focus({ preventScroll: true });
    }
    return true;
  }
  function open(name, onClose, returnFocus) {
    const next = typeof name === 'string' ? { id: name, onClose, returnFocus } : { ...name };
    if (!next.id || typeof next.onClose !== 'function') throw new Error('An overlay needs an identity and a close action.');
    if (active?.id === next.id) return active.id;
    if (next.modal && active) {
      if (active.root) { active.savedInert = active.root.inert; active.root.inert = true; active.root.setAttribute('aria-hidden', 'true'); }
      suspended.push(active); active = null;
    }
    if(active&&!close(null, 'replacement'))return false;
    if(active&&!close(null, 'replacement'))return false;
    if(active)return false;
    if (document.body?.classList.contains('mobile-menu-open')) {
      if (typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu(false);
      if (typeof window.toggleStaffMobileMenu === 'function') window.toggleStaffMobileMenu(false);
    }
    next.returnFocus ||= document.activeElement;
    active = next;
    if (document.body) {
      bodyState ||= { overflow: document.body.style.overflow, overscroll: document.body.style.overscrollBehavior,
        scrollX: window.scrollX || 0, scrollY: window.scrollY || 0 };
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      document.body.classList.add('vv-overlay-open');
    }
    window.dispatchEvent(new CustomEvent('vv:overlay-open', { detail: { id: next.id } }));
    return next.id;
  }
  function closeAll(reason='navigation') { let count=0; while(active && count++<12) { if(!close(null,reason))return false; }return true; }
  window.VoxelOverlay = { open, close, closeAll, get active() { return active?.id || null; } };
  window.addEventListener('pagehide', () => closeAll('navigation-unload'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.preventDefault(); close(null, 'escape'); }
  });
  document.addEventListener('click', event => {
    const menu = event.target.closest?.('[data-mobile-menu-action]');
    if (menu && ['open', 'toggle'].includes(menu.dataset.mobileMenuAction)) close(null, 'navigation');
  }, true);
})();
