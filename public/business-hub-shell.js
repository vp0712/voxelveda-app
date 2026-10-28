/* Presentation only: retain existing links, permissions, handlers and records. */
(() => {
  'use strict';
  const paths = {
    home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    document: 'M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h8',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    box: 'm3 7 9-5 9 5v10l-9 5-9-5ZM3 7l9 5 9-5M12 12v10M7 4l9 5',
    task: 'M9 5h12M9 12h12M9 19h12M2 5l2 2 3-4M2 12l2 2 3-4M2 19l2 2 3-4',
    clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
    calendar: 'M8 2v4M16 2v4M3 10h18M3 4h18v18H3ZM7 14h3M14 14h3M7 18h3',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
    shield: 'm12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    briefcase: 'M8 7V3h8v4M2 7h20v14H2ZM2 12l10 4 10-4M10 12h4',
    mail: 'M2 4h20v16H2ZM2 4l10 8L22 4',
    logout: 'M9 3H3v18h6M9 12h13M17 7l5 5-5 5',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1.5 4.5 6 6',
    chevron: 'm9 5 7 7-7 7'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('hub-nav-icon');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name] || paths.document);
    svg.append(path);
    return svg;
  }
  function kind(node) {
    const key = [node.dataset.section, node.getAttribute('href'), node.getAttribute('data-title'), node.textContent].join(' ').toLowerCase();
    if (/logout|sign out/.test(key)) return 'logout';
    if (/dashboard|home|workspace/.test(key)) return 'home';
    if (/roster|calendar|meeting|availability/.test(key)) return 'calendar';
    if (/attendance|timesheet|clock/.test(key)) return 'clock';
    if (/staff|customer|supplier|people|recruit|profile/.test(key)) return 'people';
    if (/stock|material|packag|inventory/.test(key)) return 'box';
    if (/task|approval|leave/.test(key)) return 'task';
    if (/security|compliance|quality/.test(key)) return 'shield';
    if (/setting/.test(key)) return 'settings';
    if (/procurement|production|floor/.test(key)) return 'briefcase';
    if (/message|notification|support/.test(key)) return 'mail';
    return 'document';
  }
  function decorate(sidebar) {
    for (const node of sidebar.querySelectorAll('.nav-btn,.nav-group-toggle,.logout-btn')) {
      if (!node.querySelector(':scope > .hub-nav-icon')) node.prepend(icon(kind(node)));
    }
    const search = sidebar.querySelector('.workspace-nav-search,.portal-nav-search');
    if (search && !search.querySelector('.hub-nav-icon')) search.prepend(icon('search'));
    const input = search?.querySelector('input');
    if (input && !input.placeholder) input.placeholder = 'Search pages…';
  }
  function link(label, href) {
    const node = document.createElement('a');
    node.className = 'nav-btn'; node.textContent = label; node.href = href;
    return node;
  }
  function companion() {
    if (document.querySelector('.app-shell > .sidebar,.hub-companion-sidebar')) return;
    const allowed = ['/client', '/account', '/profile', '/security', '/quality', '/shop-floor', '/careers-admin', '/employee-id', '/invoice/view'];
    if (!allowed.includes(location.pathname) || document.querySelector('.status-code')?.textContent.trim() === '403') return;
    const main = document.querySelector('main');
    if (!main) return;
    const aside = document.createElement('aside');
    aside.className = 'sidebar hub-companion-sidebar'; aside.id = 'hubCompanionSidebar';
    aside.setAttribute('aria-label', 'Workspace navigation');
    const brand = document.createElement('a'); brand.className = 'brand shell-brand'; brand.href = '/dashboard';
    const logo = document.createElement('img'); logo.src = '/logo.png'; logo.alt = 'Voxel Veda'; logo.className = 'logo-img';
    const copy = document.createElement('div'), title = document.createElement('strong'), subtitle = document.createElement('small');
    title.textContent = 'VOXEL VEDA'; subtitle.textContent = 'Company workspace'; copy.append(title, subtitle); brand.append(logo, copy);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'sidebar-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close menu');
    const nav = document.createElement('nav'); nav.className = 'sidebar-nav'; nav.setAttribute('aria-label', 'Workspace pages');
    nav.append(link('Home', '/dashboard'));
    // Reuse only links already available on this authenticated page.
    const existing = document.querySelectorAll('#clientNavigation a[href],header a[href],.top a[href]');
    const seen = new Set(['/dashboard']);
    for (const original of existing) {
      const href = original.getAttribute('href');
      const label = original.textContent.trim();
      if (!href || !label || seen.has(href) || label.includes('VOXEL VEDA')) continue;
      const url = new URL(href, location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.username || url.password || original.matches('[hidden],.hidden-section,[aria-hidden="true"]')) continue;
      seen.add(href); nav.append(link(label.replace(/^←\s*/, ''), href));
    }
    const titles = {'/account':'Account', '/profile':'My profile', '/security':'Account security', '/quality':'Quality & Manufacturing', '/shop-floor':'Shop Floor', '/careers-admin':'Recruitment', '/employee-id':'Employee identity', '/invoice/view':'Invoice viewer'};
    if (titles[location.pathname] && !seen.has(location.pathname)) {
      nav.append(link(titles[location.pathname], location.pathname + location.search)); seen.add(location.pathname);
    }
    for (const [label, href] of [['My profile', '/profile'], ['Account security', '/security'], ['Support', '/support']]) {
      if (!seen.has(href)) nav.append(link(label, href));
    }
    const markActive = () => {
      const selectedHash = location.pathname === '/client' && [...nav.querySelectorAll('a')].some(item => item.getAttribute('href') === location.hash);
      for (const item of nav.querySelectorAll('a')) {
        const url = new URL(item.href, location.href);
        const selected = url.pathname === location.pathname && (!url.hash || url.hash === location.hash) || location.pathname === '/client' && (selectedHash ? item.getAttribute('href') === location.hash : item.getAttribute('href') === '/dashboard');
        item.classList.toggle('active', selected);
        if (selected) item.setAttribute('aria-current', url.hash ? 'location' : 'page'); else item.removeAttribute('aria-current');
      }
    };
    markActive(); window.addEventListener('hashchange', markActive);
    const footer = document.createElement('div'); footer.className = 'sidebar-footer'; footer.append(link('Return to workspace', '/dashboard'));
    aside.append(close, brand, nav, footer);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'hub-companion-toggle'; toggle.textContent = '☰';
    toggle.setAttribute('aria-label', 'Open workspace menu'); toggle.setAttribute('aria-controls', aside.id); toggle.setAttribute('aria-expanded', 'false');
    const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.className = 'hub-companion-backdrop'; backdrop.setAttribute('aria-label', 'Close workspace menu'); backdrop.hidden = true;
    let returnFocus, savedOverflow;
    const dismiss = () => {
      document.body.classList.remove('hub-companion-open'); backdrop.hidden = true; toggle.setAttribute('aria-expanded', 'false');
      if (!window.VoxelOverlay) document.body.style.overflow = savedOverflow || '';
      returnFocus?.focus({ preventScroll: true });
    };
    const closeMenu = reason => {
      if (window.VoxelOverlay?.active === 'companion-navigation') window.VoxelOverlay.close('companion-navigation', reason);
      else dismiss();
    };
    const open = () => {
      if (document.body.classList.contains('hub-companion-open')) return closeMenu('dismiss');
      returnFocus = document.activeElement;
      if (window.VoxelOverlay?.open({ id: 'companion-navigation', root: aside, onClose: dismiss, returnFocus }) === false) return;
      if (!window.VoxelOverlay) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
      document.body.classList.add('hub-companion-open'); backdrop.hidden = false; toggle.setAttribute('aria-expanded', 'true'); close.focus();
    };
    toggle.onclick = open;
    close.onclick = backdrop.onclick = () => closeMenu('dismiss');
    aside.addEventListener('click', event => { if (event.target.closest('a') && document.body.classList.contains('hub-companion-open')) closeMenu('navigation'); });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('hub-companion-open') || (window.VoxelOverlay && window.VoxelOverlay.active !== 'companion-navigation')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeMenu('escape'); }
      if (event.key !== 'Tab') return;
      const controls = [...aside.querySelectorAll('a[href],button:not([disabled])')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!controls.includes(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    const desktop = matchMedia('(min-width:1024px)');
    desktop.addEventListener('change', event => { if (event.matches && document.body.classList.contains('hub-companion-open')) closeMenu('resize'); });
    let header = document.querySelector('body > header') || main.querySelector('header,.top');
    if (!header) {
      header = document.createElement('header');
      const title = document.createElement('strong'); title.textContent = document.title.split('|')[0].trim(); header.append(title); main.prepend(header);
    }
    header.classList.add('hub-companion-header'); header.prepend(toggle);
    document.body.classList.add('hub-companion-shell'); main.classList.add('hub-companion-content');
    document.body.prepend(aside, backdrop);
    decorate(aside);
  }
  function sync() {
    companion();
    const sidebars = document.querySelectorAll('.sidebar');
    for (const sidebar of sidebars) decorate(sidebar);
    if (!sidebars.length) return;
    document.body.dataset.vvShell = 'business-hub';
    for (const heading of document.querySelectorAll('.topbar-title,.staff-header-heading')) {
      if (heading.querySelector('.hub-header-context')) continue;
      const context = document.createElement('span'); context.className = 'hub-header-context'; context.textContent = 'VOXEL VEDA / WORKSPACE';
      heading.prepend(context);
    }
    const topbar = document.querySelector('.app-shell .topbar');
    if (topbar && !topbar.querySelector('.hub-find-page')) {
      const search = document.querySelector('.sidebar .workspace-nav-search input,.sidebar .portal-nav-search input');
      if (search) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'hub-find-page'; button.setAttribute('aria-label', 'Find a page in navigation');
        button.append(icon('search'), document.createTextNode('Find a page'));
        const hint = document.createElement('kbd'); hint.textContent = 'Ctrl K'; button.append(hint);
        button.onclick = () => search.focus();
        const actions = topbar.querySelector('.topbar-actions,.staff-top-actions');
        if (actions) topbar.insertBefore(button, actions); else topbar.append(button);
      }
    }
  }
  function start() {
    sync();
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || window.VoxelOverlay?.active) return;
      const search = document.querySelector('.sidebar .workspace-nav-search input,.sidebar .portal-nav-search input');
      if (!search || !search.getClientRects().length) return;
      event.preventDefault(); search.focus();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
