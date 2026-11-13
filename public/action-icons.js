/* Compact presentation only. Original labels, handlers, permissions and states stay authoritative. */
(() => {
  'use strict';
  const paths = Object.freeze({
    view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    document: 'M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h6',
    pdf: 'M14 2H5v20h14V7ZM14 2v5h5M8 11h8',
    email: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 6l9 7 9-7',
    payment: 'M3 5h18v14H3ZM3 9h18M6 14h4M16 12v5M14 13h3a1 1 0 0 1 0 2h-3',
    edit: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z',
    qr: 'M3 3h6v6H3ZM15 3h6v6h-6ZM3 15h6v6H3ZM15 15h2v2h-2ZM19 13h2v4M13 19h4v2M19 19h2v2',
    archive: 'M3 4h18v4H3ZM5 8v12h14V8M9 12h6',
    restore: 'M3 10a9 9 0 1 1 1 8M3 4v6h6M12 7v6l4 2',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    approve: 'M21 12a9 9 0 1 1-5-8M8 11l4 4L22 4',
    reject: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 8l8 8M16 8l-8 8',
    history: 'M3 10a9 9 0 1 1 1 8M3 4v6h6M12 7v5l4 2',
    download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v5h16v-5',
    add: 'M12 4v16M4 12h16',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0M15 15l6 6',
    refresh: 'M21 11a9 9 0 0 0-16-6L3 8M3 3v5h5M3 13a9 9 0 0 0 16 6l2-3M16 16h5v5',
    submit: 'm3 3 19 9-19 9 4-9ZM7 12h15',
    cancel: 'M6 6l12 12M18 6 6 18',
    save: 'M4 3h14l3 3v15H3V3ZM7 3v6h10V3M7 21v-8h10v8',
    close: 'M6 6l12 12M18 6 6 18',
    print: 'M6 8V3h12v5M6 17H3V8h18v9h-3M6 13h12v8H6ZM17 11h1',
    copy: 'M8 8h13v13H8ZM16 8V3H3v13h5',
    share: 'M12 16V3M7 8l5-5 5 5M5 13v8h14v-8',
    calendar: 'M4 5h16v16H4ZM8 2v6M16 2v6M4 10h16M8 14h2M14 14h2M8 18h2',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 2',
    tasks: 'M10 5h11M10 12h11M10 19h11M2 5l2 2 3-4M2 12l2 2 3-4M2 19l2 2 3-4',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    filter: 'M3 4h18l-7 8v7l-4 2v-9Z',
    sort: 'M8 3v18M4 7l4-4 4 4M16 21V3M12 17l4 4 4-4',
    link: 'm10 14 4-4M8 16l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M13 15a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2',
    access: 'M14 8a5 5 0 1 1-5-5 5 5 0 0 1 5 5ZM13 12l8 8M17 16l3-3M19 18l3-3',
    password: 'M6 10V7a6 6 0 0 1 12 0v3M4 10h16v12H4ZM12 14v4',
    security: 'm12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6ZM8 12l3 3 5-6',
    terminate: 'M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 22v-3a7 7 0 0 1 9-7M15 14l7 7M22 14l-7 7',
    issue: 'M3 7l9-5 9 5v10l-9 5-9-5ZM3 7l9 5 9-5M12 12v10M7 4l9 5M15 15h6M18 12l3 3-3 3',
    start: 'm8 4 13 8-13 8Z',
    pause: 'M6 4h4v16H6ZM14 4h4v16h-4Z',
    complete: 'M4 12l5 5L21 5',
    correction: 'M4 17v4h4L20 9l-4-4ZM14 7l4 4M4 11V4h7M4 4l7 7',
    revision: 'M14 2H5v20h8M14 2v5h5v5M8 11h6M8 15h3M15 20l4-4 3 3-4 4h-3Z',
    previous: 'm15 5-7 7 7 7',
    next: 'm9 5 7 7-7 7',
    'zoom-in': 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0M15 15l6 6M7 10h6M10 7v6',
    'zoom-out': 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0M15 15l6 6M7 10h6',
    'fit-width': 'M3 4v16M21 4v16M5 12h14M9 8l-4 4 4 4M15 8l4 4-4 4',
    home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3Z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 22v-3a8 8 0 0 1 16 0v3',
    bell: 'M18 8a6 6 0 0 0-12 0v6l-3 4h18l-3-4ZM9 21h6',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z'
  });
  const excluded = '.sidebar,.chart-grid,.expense-chart-grid,.supplier-intelligence-card,.vv-chart-data,#actionFeedback,.vv-feedback-backdrop,.dialog-actions,.form-actions,.vv-notification-panel,.vv-notification-entry,.vv-notification-record-dialog';
  const groups = '.row-actions,.record-actions,.table-action-stack,.invoice-actions,.invoice-document-actions,.procurement-actions,.quality-report-actions,.quality-pdf-controls,.workflow-item-actions,.opActions,.vv-action-toolbar';
  const candidates = '[data-vv-action-icon],tbody button,tbody a[class*="btn"],button[onclick],.row-actions button,.record-actions button,.table-action-stack button,.vv-document-email-doc-actions button,.document-reader .reader-actions button';
  const state = new WeakMap();
  const glyphs = new Map();
  let tip, tipTarget, queued = false;
  const plain = value => String(value || '').replace(/\s+/g, ' ').trim();
  function infer(label) {
    const name = plain(label).toLowerCase();
    if (/^(?:preview|view|download|open|print)?\s*(?:invoice\s+)?pdf(?:\s|$)|^(?:view|preview) invoice pdf$/.test(name)) return 'pdf';
    if (/^(?:e-?mail|send (?:by |via )?email)(?:\s|$)/.test(name)) return 'email';
    for (const [pattern, action] of [[/^(?:view|open)(?:\s|$)/,'view'],[/^edit(?:\s|$)/,'edit'],[/^archive(?:\s|$)/,'archive'],[/^restore(?:\s|$)/,'restore'],[/^(?:delete|remove)(?:\s|$)/,'delete'],[/^approve(?:\s|$)/,'approve'],[/^reject(?:\s|$)/,'reject'],[/^(?:record payment|pay|payment history|payments)(?:\s|$)/,'payment'],[/^(?:download|export)(?:\s|$)/,'download'],[/^copy(?:\s|$)/,'copy'],[/^(?:history|audit)(?:\s|$)/,'history'],[/^print(?:\s|$)/,'print'],[/^(?:refresh|reload|retry)(?:\s|$)/,'refresh'],[/^(?:qr|invoice link qr)(?:\s|$)/,'qr'],[/^(?:add|new|create)(?:\s|$)/,'add'],[/^search(?:\s|$)/,'search'],[/^filter(?:\s|$)/,'filter'],[/^upload(?:\s|$)/,'upload']]) if (pattern.test(name)) return action;
    return null;
  }
  function glyph(name) {
    if (!Object.hasOwn(paths, name)) return null;
    if (glyphs.has(name)) return glyphs.get(name);
    const stamp = name === 'pdf' ? '<text x="12" y="19" text-anchor="middle" stroke="none" fill="black" font-family="Arial,sans-serif" font-size="6" font-weight="bold">PDF</text>' : '';
    const value = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + paths[name] + '"/>' + stamp + '</svg>') + '")';
    glyphs.set(name, value); return value;
  }
  function set(node, name, value) { if (node.getAttribute(name) !== value) node.setAttribute(name, value); }
  function decorate(node) {
    if (!node.matches('button,a,summary') || node.closest(excluded)) return;
    const explicit = node.getAttribute('data-vv-action-icon');
    if (!explicit && (node.closest('form,nav,header') || node.closest('[role="dialog"],.dialog-panel') && !node.closest('.vv-document-email-doc-actions,.reader-actions'))) return;
    const text = plain(node.textContent);
    const name = explicit || infer(text);
    if (!glyph(name)) return;
    let saved = state.get(node);
    if (!saved) { saved = { ownLabel: !node.hasAttribute('aria-label'), ownTitle: !node.hasAttribute('title'), label: null, title: null }; state.set(node, saved); }
    if (saved.label !== null && node.getAttribute('aria-label') !== saved.label) saved.ownLabel = false;
    if (saved.title !== null && node.getAttribute('title') !== saved.title) saved.ownTitle = false;
    const label = saved.ownLabel ? text || plain(node.getAttribute('title')) : plain(node.getAttribute('aria-label')) || text;
    if (!label) return;
    if (saved.ownLabel) { set(node, 'aria-label', label); saved.label = label; }
    if (saved.ownTitle) { set(node, 'title', label); saved.title = label; }
    set(node, 'data-vv-icon-label', plain(node.getAttribute('title')) || label);
    if (!explicit) set(node, 'data-vv-action-icon', name);
    // Keep the original text value and listeners while moving bare text into
    // the same visually hidden treatment as existing nested labels. Some
    // retained page rules set button font sizes with ID-specific !important.
    for (const child of [...node.childNodes]) if (child.nodeType === 3 && plain(child.nodeValue)) {
      const textLabel = document.createElement('span'); textLabel.className = 'vv-action-label';
      textLabel.textContent = child.nodeValue; node.replaceChild(textLabel, child);
    }
    node.classList.add('vv-icon-action');
    if (node.style.getPropertyValue('--vv-action-glyph') !== glyph(name)) node.style.setProperty('--vv-action-glyph', glyph(name));
    const group = node.closest(groups); if (group && !group.matches('td,th,tr,table')) group.classList.add('vv-action-toolbar');
    if (tipTarget === node) show(node);
  }
  function enhance(root = document) {
    if (root.matches?.(candidates)) decorate(root);
    for (const node of root.querySelectorAll?.(candidates) || []) decorate(node);
    if (tipTarget && !tipTarget.isConnected) hide();
  }
  function hide() { if (tip) tip.hidden = true; if (tipTarget) { const ids = (tipTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'vv-action-tooltip'); if (ids.length) tipTarget.setAttribute('aria-describedby', ids.join(' ')); else tipTarget.removeAttribute('aria-describedby'); } tipTarget = null; }
  function show(node) {
    if (!node?.isConnected || !node.getClientRects().length) return hide();
    if (!tip) { tip = document.createElement('div'); tip.id = 'vv-action-tooltip'; tip.className = 'vv-action-tooltip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.append(tip); }
    if (tipTarget !== node) hide(); tipTarget = node;
    const label = node.dataset.vvIconLabel || node.getAttribute('aria-label');
    if (tip.textContent !== label) tip.textContent = label; tip.hidden = false;
    const ids = new Set((node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); ids.add(tip.id); set(node, 'aria-describedby', [...ids].join(' '));
    const rect = node.getBoundingClientRect(), box = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2)) + 'px';
    tip.style.top = Math.max(8, rect.top >= box.height + 14 ? rect.top - box.height - 7 : Math.min(innerHeight - box.height - 8, rect.bottom + 7)) + 'px';
  }
  function start() {
    enhance();
    new MutationObserver(records => { if (records.every(record => record.target === tip || tip?.contains(record.target))) return; if (queued) return; queued = true; queueMicrotask(() => { queued = false; enhance(); }); }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-vv-action-icon', 'aria-label', 'title'] });
    document.addEventListener('pointerover', event => { const node = event.target.closest?.('.vv-icon-action'); if (node && !node.contains(event.relatedTarget)) show(node); });
    document.addEventListener('pointerout', event => { if (tipTarget && !tipTarget.contains(event.relatedTarget)) hide(); });
    document.addEventListener('focusin', event => { const node = event.target.closest?.('.vv-icon-action'); if (node) show(node); else hide(); });
    document.addEventListener('focusout', event => { if (tipTarget && !tipTarget.contains(event.relatedTarget)) hide(); });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('resize', hide); document.addEventListener('scroll', hide, true); window.addEventListener('vv:auth-changed', hide);
  }
  window.VoxelActionIcons = Object.freeze({ enhance, infer, names: Object.freeze(Object.keys(paths)) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
