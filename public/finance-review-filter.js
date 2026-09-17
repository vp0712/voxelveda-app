(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { filter: 'IMPORTABLE' };
  const FILTERS = new Set(['IMPORTABLE', 'ALL', 'VALID', 'WARNING', 'DUPLICATE', 'REJECTED']);

  function installStyles() {
    if ($('financeReviewFilterStyles')) return;
    const style = document.createElement('style');
    style.id = 'financeReviewFilterStyles';
    style.textContent = `
      #reviewSummary [data-review-filter]{cursor:pointer;transition:box-shadow .15s ease,border-color .15s ease,background .15s ease;user-select:none}
      #reviewSummary [data-review-filter]:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
      #reviewSummary [data-review-filter].active-filter{border-color:#60a5fa;background:#eff6ff;box-shadow:0 0 0 2px rgba(59,130,246,.08)}
      .review-filter-empty td{padding:18px!important}
      .review-empty-state{border:1px dashed #cbd5e1;border-radius:14px;padding:22px 18px;text-align:center;background:#f8fafc;color:#64748b}
      .review-empty-state strong{display:block;color:#0f172a;font-size:.96rem;line-height:1.45;margin-bottom:6px}
      .review-empty-state span{display:block;font-size:.8rem;line-height:1.45}
      @media(max-width:760px){
        .review-filter-empty{display:block!important;grid-template-columns:1fr!important;padding:0!important;border:0!important;box-shadow:none!important}
        .review-filter-empty td{display:block!important;grid-column:1/-1!important;padding:0!important}
        .review-filter-empty td::before{display:none!important}
        .review-empty-state{padding:18px 14px}
      }
    `;
    document.head.appendChild(style);
  }

  function statusOf(row) {
    return String(row.querySelector('.review-status')?.textContent || '').trim().toUpperCase();
  }

  function visibleFor(status) {
    if (state.filter === 'ALL') return true;
    if (state.filter === 'IMPORTABLE') return status === 'VALID' || status === 'WARNING';
    return status === state.filter;
  }

  function realRows() {
    return [...($('reviewRows')?.querySelectorAll('tr') || [])].filter((row) => !row.classList.contains('review-filter-empty'));
  }

  function counts() {
    const result = { ALL: 0, VALID: 0, WARNING: 0, DUPLICATE: 0, REJECTED: 0, IMPORTABLE: 0 };
    realRows().forEach((row) => {
      const status = statusOf(row);
      result.ALL += 1;
      if (Object.prototype.hasOwnProperty.call(result, status)) result[status] += 1;
      if (status === 'VALID' || status === 'WARNING') result.IMPORTABLE += 1;
    });
    return result;
  }

  function removeEmptyMessage() {
    $('reviewRows')?.querySelector('.review-filter-empty')?.remove();
  }

  function addEmptyMessage(summary) {
    const host = $('reviewRows');
    if (!host) return;
    const excluded = summary.REJECTED + summary.DUPLICATE;
    let message;
    if (state.filter === 'IMPORTABLE') {
      message = `No transactions are available to import.${excluded ? ` ${excluded} excluded row(s) are hidden. Tap Rejected or Duplicates above only if you want to inspect them.` : ''}`;
    } else if (state.filter === 'ALL') {
      message = 'No statement rows are available.';
    } else {
      message = `No ${state.filter.toLowerCase()} rows are available.`;
    }
    const row = document.createElement('tr');
    row.className = 'review-filter-empty';
    row.innerHTML = `<td colspan="7"><div class="review-empty-state"><strong>${message}</strong><span>Rejected and duplicate rows stay excluded from import.</span></div></td>`;
    host.appendChild(row);
  }

  function markActive() {
    const summary = $('reviewSummary');
    if (!summary) return;
    summary.querySelectorAll('[data-review-filter]').forEach((item) => {
      const filter = String(item.dataset.reviewFilter || '').toUpperCase();
      const active = state.filter === filter || (state.filter === 'IMPORTABLE' && (filter === 'VALID' || filter === 'WARNING'));
      item.classList.toggle('active-filter', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  function applyFilter() {
    const host = $('reviewRows');
    if (!host) return;
    removeEmptyMessage();
    const rows = realRows();
    rows.forEach((row) => { row.hidden = !visibleFor(statusOf(row)); });
    const visible = rows.filter((row) => !row.hidden).length;
    const summary = counts();
    if (!visible) addEmptyMessage(summary);
    markActive();
  }

  function decorateSummary() {
    const summary = $('reviewSummary');
    if (!summary) return;
    const mapping = [
      ['total', 'ALL'],
      ['valid', 'VALID'],
      ['warnings', 'WARNING'],
      ['duplicates', 'DUPLICATE'],
      ['rejected', 'REJECTED']
    ];
    const items = [...summary.querySelectorAll('span')];
    mapping.forEach(([label, filter]) => {
      const item = items.find((node) => String(node.textContent || '').toLowerCase().includes(label));
      if (!item) return;
      item.dataset.reviewFilter = filter;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `Show ${label} statement rows`);
    });
    markActive();
  }

  function selectFilter(filter) {
    const normalized = String(filter || '').toUpperCase();
    if (!FILTERS.has(normalized)) return;
    state.filter = normalized;
    applyFilter();
  }

  function activate(event) {
    const item = event.target.closest?.('[data-review-filter]');
    if (!item) return;
    event.preventDefault();
    selectFilter(item.dataset.reviewFilter);
  }

  function install() {
    const dialog = $('reviewDialog');
    const summary = $('reviewSummary');
    const rows = $('reviewRows');
    if (!dialog || !summary || !rows) return;
    installStyles();

    summary.addEventListener('click', activate);
    summary.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      activate(event);
    });

    new MutationObserver(() => {
      decorateSummary();
      applyFilter();
    }).observe(summary, { childList: true, subtree: true });

    new MutationObserver((mutations) => {
      const onlyOwnEmptyState = mutations.every((mutation) => {
        const changed = [...mutation.addedNodes, ...mutation.removedNodes].filter((node) => node.nodeType === 1);
        return changed.length && changed.every((node) => node.classList?.contains('review-filter-empty'));
      });
      if (!onlyOwnEmptyState) window.setTimeout(applyFilter, 0);
    }).observe(rows, { childList: true, subtree: true });

    new MutationObserver(() => {
      if (!dialog.open) return;
      state.filter = 'IMPORTABLE';
      window.setTimeout(() => {
        decorateSummary();
        applyFilter();
      }, 0);
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

    decorateSummary();
    applyFilter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
