/* Read-only company folders over the original authorised invoice register. */
(() => {
  'use strict';
  const keyPattern = /^[a-f0-9]{64}$/;
  const instances = new WeakMap();
  const folderGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3Z"/><path d="M3 6V4h7l2 2h6v2"/></svg>';
  function create(options) {
    const host = options?.host;
    if (!host) return null;
    if (instances.has(host)) return instances.get(host);
    let epoch = 0, page = 1, search = '', totalPages = 1, lastOwner = null;
    const names = new Map();
    host.dataset.invoiceFolders = '';
    host.classList.add('vv-invoice-folders');
    host.innerHTML = '<div class="vv-invoice-folder-heading"><div><h3>Company folders</h3><p>Existing and new invoices appear here automatically.</p></div><div class="vv-invoice-folder-actions"><button type="button" class="secondary-btn" data-invoice-folder-all>All invoices</button><button type="button" class="secondary-btn" data-invoice-folder-refresh data-vv-action-icon="refresh" aria-label="Refresh company folders" title="Refresh company folders">Refresh company folders</button></div></div><div class="vv-invoice-folder-selected" hidden><span aria-hidden="true">' + folderGlyph + '</span><strong data-invoice-folder-title>Company invoices</strong></div><form class="vv-invoice-folder-search"><label><span>Find a company</span><input data-invoice-folder-search type="search" maxlength="120" placeholder="Company or email"></label><button type="submit" class="secondary-btn" data-vv-action-icon="search" aria-label="Search company folders" title="Search company folders">Search company folders</button></form><p data-invoice-folder-status role="status" aria-live="polite"></p><div class="vv-invoice-folder-grid"></div><nav class="vv-invoice-folder-pages" aria-label="Company folder pages"><button type="button" class="secondary-btn" data-invoice-folder-prev data-vv-action-icon="previous" aria-label="Previous company folders" title="Previous company folders">Previous company folders</button><span data-invoice-folder-page></span><button type="button" class="secondary-btn" data-invoice-folder-next data-vv-action-icon="next" aria-label="Next company folders" title="Next company folders">Next company folders</button></nav><button type="button" class="secondary-btn" data-invoice-folder-retry data-vv-action-icon="refresh" aria-label="Retry company folders" title="Retry company folders" hidden>Retry company folders</button>';
    const status = host.querySelector('[data-invoice-folder-status]'), grid = host.querySelector('.vv-invoice-folder-grid');
    const form = host.querySelector('form'), input = host.querySelector('[data-invoice-folder-search]');
    const previous = host.querySelector('[data-invoice-folder-prev]'), next = host.querySelector('[data-invoice-folder-next]');
    const pages = host.querySelector('.vv-invoice-folder-pages'), retry = host.querySelector('[data-invoice-folder-retry]');
    const selectedPanel = host.querySelector('.vv-invoice-folder-selected'), title = host.querySelector('[data-invoice-folder-title]');
    const selection = () => String(options.selection?.() || '');
    const owner = () => String(options.owner?.() ?? localStorage.getItem('user') ?? '');
    const invalidate = () => { epoch++; page = 1; search = ''; input.value = ''; grid.replaceChildren(); names.clear(); title.textContent = 'Company invoices'; selectedPanel.hidden = pages.hidden = true; status.textContent = ''; host.querySelector('[data-invoice-folder-page]').textContent = ''; host.removeAttribute('aria-busy'); delete host.dataset.selectedFolder; lastOwner = null; host.hidden = true; };
    function displayError(message) {
      status.textContent = message;
      status.setAttribute('role', 'alert');
      pages.hidden = true; retry.hidden = false;
      previous.disabled = next.disabled = true;
    }
    async function refresh() {
      const request = ++epoch, account = owner(), selected = selection();
      host.hidden = false; host.dataset.selectedFolder = selected;
      if (lastOwner !== null && account !== lastOwner) { names.clear(); page = 1; search = ''; input.value = ''; }
      lastOwner = account;
      const isSelected = Boolean(selected);
      selectedPanel.hidden = !isSelected;
      form.hidden = grid.hidden = pages.hidden = isSelected;
      host.querySelector('[data-invoice-folder-all]').setAttribute('aria-pressed', String(!isSelected));
      title.textContent = names.get(selected) || 'Company invoices';
      grid.replaceChildren(); retry.hidden = true; host.querySelector('[data-invoice-folder-page]').textContent = '';
      status.setAttribute('role', 'status'); status.textContent = isSelected ? 'Loading company folder…' : 'Loading company folders…';
      previous.disabled = next.disabled = true;
      host.setAttribute('aria-busy', 'true');
      if (selected && !keyPattern.test(selected)) {
        displayError('This company folder link is invalid. Choose All invoices to return to the register.');
        host.removeAttribute('aria-busy'); return;
      }
      const query = new URLSearchParams(options.query?.() || {}), sourceQuery = query.toString();
      const current = () => request === epoch && account === owner() && selected === selection() && sourceQuery === new URLSearchParams(options.query?.() || {}).toString();
      query.set('page', String(isSelected ? 1 : page)); query.set('limit', '12'); query.set('sort', 'customer'); query.set('direction', 'asc');
      if (isSelected) { query.set('folder', selected); query.delete('company_search'); }
      else { query.delete('folder'); if (search) query.set('company_search', search); else query.delete('company_search'); }
      try {
        const response = await fetch('/api/invoice/folders?' + query, { headers: options.headers?.() || {}, credentials: 'same-origin', cache: 'no-store' });
        let data; try { data = await response.json(); } catch { throw new Error('Company folders returned an unreadable response. Please retry.'); }
        if (!current()) return;
        if (!response.ok) throw new Error(data.message || 'Company folders could not be loaded. Please retry.');
        if (!Array.isArray(data.folders) || !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0 || !Number.isSafeInteger(Number(data.invoice_total)) || Number(data.invoice_total) < 0 ||
          data.folders.some(item => !keyPattern.test(String(item.key || '')) || !Number.isSafeInteger(Number(item.invoice_count)) || Number(item.invoice_count) < 1)) throw new Error('Company folders could not be verified. Please retry.');
        totalPages = Math.max(1, Math.ceil(Number(data.total) / 12));
        if (!isSelected && page > totalPages) { page = totalPages; return refresh(); }
        for (const folder of data.folders) names.set(folder.key, String(folder.name || 'Company not recorded'));
        if (isSelected) {
          const folder = data.folders.find(item => item.key === selected);
          title.textContent = folder ? names.get(selected) : names.get(selected) || 'Company invoices';
          status.textContent = folder ? `${Number(folder.invoice_count)} matching invoice${Number(folder.invoice_count) === 1 ? '' : 's'} in this company folder.` : 'No authorised invoices match the current filters in this company folder.';
          return;
        }
        status.textContent = data.folders.length ? `${Number(data.total)} company folder${Number(data.total) === 1 ? '' : 's'} · ${Number(data.invoice_total || 0)} matching invoices` : search ? 'No company folders match this search.' : 'No company folders match the current invoice filters.';
        for (const folder of data.folders) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'vv-invoice-folder-card'; button.dataset.invoiceFolder = folder.key;
          button.setAttribute('aria-label', `Open ${names.get(folder.key)} company folder, ${Number(folder.invoice_count)} invoices`);
          const glyph = document.createElement('span'); glyph.className = 'vv-invoice-folder-glyph'; glyph.innerHTML = folderGlyph;
          const name = document.createElement('strong'); name.textContent = names.get(folder.key);
          const email = document.createElement('span'); email.className = 'vv-invoice-folder-email'; email.textContent = folder.email || 'Email not recorded';
          const details = document.createElement('span'); details.className = 'vv-invoice-folder-meta';
          const date = /^\d{4}-\d{2}-\d{2}/.exec(String(folder.latest_invoice_at || ''))?.[0];
          details.textContent = `${Number(folder.invoice_count)} invoice${Number(folder.invoice_count) === 1 ? '' : 's'}${date ? ' · Latest ' + date : ''}`;
          button.append(glyph, name, email, details);
          button.onclick = () => select(folder.key, names.get(folder.key));
          grid.append(button);
        }
        host.querySelector('[data-invoice-folder-page]').textContent = `Page ${page} of ${totalPages}`;
        previous.disabled = page <= 1; next.disabled = page >= totalPages;
      } catch (error) {
        if (!current()) return;
        displayError(error.message || 'Company folders could not be loaded. Please retry.');
      } finally { if (request === epoch && account === owner()) host.removeAttribute('aria-busy'); }
    }
    function select(key, name) {
      const account = owner();
      Promise.resolve(options.onSelect?.(key, name)).then(() => {
        if (account !== owner() || selection() !== key) return;
        const activeHost = host.isConnected ? host : host.id ? document.getElementById(host.id) : null;
        const target = activeHost?.querySelector(key ? '[data-invoice-folder-title]' : '.vv-invoice-folder-heading h3');
        if (target) { target.tabIndex = -1; target.focus({ preventScroll: false }); }
      }).catch(() => {});
    }
    form.onsubmit = event => { event.preventDefault(); search = input.value.trim(); page = 1; refresh(); };
    previous.onclick = () => { if (page > 1) { page--; refresh(); } };
    next.onclick = () => { if (page < totalPages) { page++; refresh(); } };
    retry.onclick = refresh;
    host.querySelector('[data-invoice-folder-refresh]').onclick = refresh;
    host.querySelector('[data-invoice-folder-all]').onclick = () => select('', '');
    const storage = event => { if (!event.key || ['user', 'token'].includes(event.key)) invalidate(); };
    window.addEventListener('storage', storage);
    const api = { refresh, invalidate, destroy() { invalidate(); window.removeEventListener('storage', storage); instances.delete(host); host.replaceChildren(); } };
    instances.set(host, api);
    return api;
  }
  window.VoxelInvoiceFolders = Object.freeze({ create, validKey: value => keyPattern.test(String(value || '')) });
})();
