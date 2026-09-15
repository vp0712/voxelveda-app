(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUPPORTED = new Set(['CSV','PDF','OFX','QFX','QIF','XLSX']);
  const state = { step: 1, busy: false };

  function stepName(index) {
    return ['Account','File','Preview','Review','Approve'][index - 1] || '';
  }

  function renderSteps() {
    document.querySelectorAll('[data-import-step]').forEach((node) => {
      const n = Number(node.dataset.importStep || 0);
      node.classList.remove('active','done','error');
      if (n < state.step) node.classList.add('done');
      else if (n === state.step) node.classList.add('active');
    });
    const line = $('importWizardStatus');
    if (line) line.textContent = state.busy ? `Step ${state.step} of 5 · Working…` : `Step ${state.step} of 5 · ${stepName(state.step)}`;
  }

  function prettySize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extension(file) {
    return String(file?.name || '').split('.').pop().toUpperCase();
  }

  function syncReadyState() {
    const account = $('importAccount');
    const fileInput = $('importFile');
    const button = $('importPreviewButton') || $('importForm')?.querySelector('button[type="submit"]');
    const summary = $('importFileSummary');
    const file = fileInput?.files?.[0];
    const hasAccount = Boolean(account?.value);
    const format = extension(file);
    const validFile = Boolean(file && SUPPORTED.has(format));

    if (!hasAccount) state.step = 1;
    else if (!file) state.step = 2;
    else state.step = 3;

    if (summary) {
      if (!file) {
        summary.className = 'import-file-summary';
        summary.innerHTML = '<strong>No file selected</strong><span>Choose CSV, OFX or QFX where possible. PDF is supported only when transaction direction can be read safely.</span>';
      } else {
        summary.className = `import-file-summary ${validFile ? 'ready' : ''}`;
        summary.innerHTML = `<strong>${String(file.name).replace(/[&<>]/g, '')}</strong><span>${format || 'Unknown format'} · ${prettySize(file.size)}${validFile ? ' · Ready to preview' : ' · Unsupported format'}</span>`;
      }
    }

    if (button && !state.busy) {
      button.disabled = !(hasAccount && validFile);
      button.textContent = hasAccount && validFile ? 'Preview statement' : 'Complete account + file first';
    }
    renderSteps();
  }

  function installReviewGuide() {
    const dialog = $('reviewDialog');
    if (!dialog) return;
    const heading = dialog.querySelector('.dialog-head');
    if (!heading || $('importReviewGuide')) return;
    const guide = document.createElement('div');
    guide.id = 'importReviewGuide';
    guide.className = 'import-review-guide';
    guide.innerHTML = '<b>Step 4 · Review before import.</b> Valid rows are ready. Warnings need your attention. Duplicates are excluded so the same transaction is not imported twice. Rejected rows cannot be imported.';
    heading.insertAdjacentElement('afterend', guide);
  }

  function observeReviewDialog() {
    const dialog = $('reviewDialog');
    if (!dialog) return;
    installReviewGuide();
    new MutationObserver(() => {
      if (dialog.open) {
        state.busy = false;
        state.step = 4;
        renderSteps();
      }
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }

  function wireImport() {
    const form = $('importForm');
    const account = $('importAccount');
    const file = $('importFile');
    if (!form || !account || !file) return;

    account.addEventListener('change', syncReadyState);
    file.addEventListener('change', syncReadyState);
    form.addEventListener('submit', () => {
      if (!form.checkValidity()) return;
      state.busy = true;
      state.step = 3;
      const button = $('importPreviewButton') || form.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = 'Checking statement…'; }
      const line = $('importWizardStatus');
      if (line) line.textContent = 'Step 3 of 5 · Reading the file, checking rows and looking for duplicates. Nothing is being imported yet.';
      renderSteps();
    }, true);

    $('commitReview')?.addEventListener('click', () => {
      state.step = 5;
      state.busy = true;
      renderSteps();
      const button = $('commitReview');
      if (button) button.textContent = 'Approving selected rows…';
    }, true);

    $('rejectReview')?.addEventListener('click', () => {
      state.busy = false;
      state.step = 4;
      renderSteps();
    }, true);

    $('importStatement')?.addEventListener('click', () => window.setTimeout(syncReadyState, 0));
    syncReadyState();
  }

  function clarifyReviewSummary() {
    const host = $('reviewSummary');
    if (!host) return;
    new MutationObserver(() => {
      const warningCount = [...host.querySelectorAll('span')].find((node) => /warnings/i.test(node.textContent || ''));
      const duplicateCount = [...host.querySelectorAll('span')].find((node) => /duplicates/i.test(node.textContent || ''));
      const guide = $('importReviewGuide');
      if (!guide) return;
      const warnings = warningCount?.querySelector('b')?.textContent || '0';
      const duplicates = duplicateCount?.querySelector('b')?.textContent || '0';
      guide.innerHTML = `<b>Step 4 · Review before import.</b> There are ${warnings} warning row(s) and ${duplicates} duplicate row(s). Duplicates stay excluded. Check warning rows, untick anything you do not want, then press “Approve & import selected rows”.`;
    }).observe(host, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireImport();
    observeReviewDialog();
    clarifyReviewSummary();
  });
})();
