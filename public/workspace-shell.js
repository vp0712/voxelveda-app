(() => {
  'use strict';
  const compact = window.matchMedia('(max-width: 1023px)');
  let returnFocus = null;
  function menu(open) {
    const sidebar = document.getElementById('primarySidebar');
    if (!sidebar) return;
    const wasOpen = document.body.classList.contains('mobile-menu-open');
    const isOpen = Boolean(open) && compact.matches;
    if (isOpen && !wasOpen) returnFocus = document.activeElement;
    document.body.classList.toggle('mobile-menu-open', isOpen);
    document.documentElement.classList.toggle('mobile-menu-open', isOpen);
    document.body.classList.toggle('vv-scroll-locked', isOpen);
    sidebar.classList.toggle('is-open', isOpen);
    sidebar.setAttribute('aria-hidden', String(compact.matches && !isOpen));
    const backdrop = document.querySelector('.mobile-sidebar-backdrop');
    if (backdrop) {
      backdrop.hidden = !isOpen;
      backdrop.classList.toggle('is-open', isOpen);
      backdrop.setAttribute('aria-hidden', String(!isOpen));
    }
    document.querySelectorAll('[data-mobile-menu-action="toggle"], [data-primary-menu]').forEach(button => button.setAttribute('aria-expanded', String(isOpen)));
    if (isOpen && !wasOpen) sidebar.querySelector('.sidebar-close, .nav-btn')?.focus({preventScroll:true});
    if (!isOpen && wasOpen && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }
  // Every ERP caller and the Finance department use this one state controller.
  window.VoxelWorkspaceMenu = { set:menu };
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('primarySidebar')) return;
    // The same primary destinations serve the ERP and its Finance department.
    document.querySelectorAll('.mobile-bottom-nav, #fmMobileNav').forEach(nav => nav.remove());
    const nav = document.createElement('nav'); nav.className = 'vv-primary-nav'; nav.setAttribute('aria-label','Primary navigation');
    nav.innerHTML = '<a href="/dashboard">Home</a><a href="/admin?view=erp">Workspace</a><a href="/admin?view=invoices" data-primary-section="invoiceSection">Sales</a><a href="/finance-intelligence#overview" data-primary-finance>Finance</a><button type="button" data-primary-menu aria-controls="primarySidebar" aria-expanded="false">Menu</button>';
    nav.querySelector('[data-primary-menu]').onclick = () => menu(!document.body.classList.contains('mobile-menu-open'));
    document.body.appendChild(nav);
    const update = () => {
      const active = sidebar.querySelector('.nav-btn.active, [aria-current="page"]');
      nav.querySelectorAll('a').forEach(a => {
        const current = document.body.classList.contains('finance-os-page') ? a.hasAttribute('data-primary-finance') : (a.getAttribute('href')==='/dashboard'?active?.dataset.section==='dashboardSection':a.href.includes('view='+ (active?.dataset.section==='invoiceSection' ? 'invoices' : 'erp')));
        if (current) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
        if (a.dataset.primarySection) a.hidden = !document.querySelector('[data-section="'+a.dataset.primarySection+'"]:not(.hidden-section)');
        if (a.hasAttribute('data-primary-finance')) { const finance=sidebar.querySelector('.app-banking-nav, a[href^="/finance-intelligence"]');a.hidden=!finance||!!finance.closest('.hidden-section'); }
      });
    };
    const sidebar = document.getElementById('primarySidebar');
    new MutationObserver(update).observe(sidebar, {attributes:true,subtree:true,attributeFilter:['class']}); update();
    document.querySelectorAll('[data-mobile-menu-action]').forEach(button => {
      if (button.dataset.mobileMenuBound === 'true') return;
      button.dataset.mobileMenuBound = 'true';
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const action = button.dataset.mobileMenuAction;
        menu(action === 'open' || (action === 'toggle' && !document.body.classList.contains('mobile-menu-open')));
      });
    });
    sidebar.addEventListener('click', event => {
      if (event.target.closest('a[href], button.nav-btn')) menu(false);
    });
    if (document.body.classList.contains('finance-os-page')) {
      const search = document.getElementById('workspaceNavSearch');
      if (search) search.oninput = () => sidebar.querySelectorAll('.nav-btn').forEach(a => a.hidden = !a.textContent.toLowerCase().includes(search.value.trim().toLowerCase()));
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape') menu(false); });
    window.addEventListener('pageshow', () => menu(false));
    window.addEventListener('pagehide', () => menu(false));
    compact.addEventListener('change', () => menu(false));
    menu(false);
    document.querySelector('[data-workspace-logout]')?.addEventListener('click', async () => {
      try { const response=await fetch('/api/auth/logout', {method:'POST',credentials:'same-origin'});if(!response.ok)throw new Error('Logout could not be completed. Please retry.');for(const key of ['token','user','role'])localStorage.removeItem(key);location.assign('/login'); } catch(error) { const feedback=document.createElement('p');feedback.setAttribute('role','alert');feedback.textContent=error.message;sidebar.append(feedback); }
    });
  });
})();
