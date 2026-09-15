(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SUPPORTED = new Set(['CSV','PDF','OFX','QFX','QIF','XLSX']);
  const state = { step: 1, busy: false };

  function stepName(index) {
    return ['Account','File','Preview','Review','Approve'][index - 1] || '';
  }

  function ensureWizardMarkup() {
    const form = $('importForm');
    if (!form || $('importWizard')) return;
    const heading = form.querySelector('.dialog-head');
    if (!heading) return;
    const wizard = document.createElement('section');
    wizard.id = 'importWizard';
    wizard.className = 'import-wizard';
    wizard.innerHTML = `
      <h3>Import in 5 safe steps</h3>
      <p>Nothing touches your finance records until the final approval step.</p>
      <div class="import-stepper" aria-label="Statement import progress">
        <div class="import-step active" data-import-step="1"><span class="n">1</span><span>Choose account</span></div>
        <div class="import-step" data-import-step="2"><span class="n">2</span><span>Choose file</span></div>
        <div class="import-step" data-import-step="3"><span class="n">3</span><span>Preview checks</span></div>
        <div class="import-step" data-import-step="4"><span class="n">4</span><span>Review rows</span></div>
        <div class="import-step" data-import-step="5"><span class="n">5</span><span>Approve import</span></div>
      </div>
      <div id="importWizardStatus" class="import-status-line">Step 1 of 5 · Account</div>`;
    heading.insertAdjacentElement('afterend', wizard);

    const fileInput = $('importFile');
    const fileLabel = fileInput?.closest('label');
    if (fileLabel && !$('importFileSummary')) {
      const summary = document.createElement('div');
      summary.id = 'importFileSummary';
      summary.className = 'import-file-summary';
      fileLabel.insertAdjacentElement('afterend', summary);
      const note = document.createElement('div');
      note.className = 'import-wizard-note';
      note.innerHTML = '<b>Best result:</b> use CSV, OFX or QFX from your bank. PDF is accepted only when debit/credit direction can be read safely.';
      summary.insertAdjacentElement('afterend', note);
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) {
      submit.id = 'importPreviewButton';
      submit.disabled = true;
      submit.textContent = 'Complete account + file first';
    }
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

  function safeName(name) {
    return String(name || '').replace(/[&<>"']/g, '');
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
        summary.innerHTML = '<strong>No file selected</strong><span>Select a bank statement to continue.</span>';
      } else {
        summary.className = `import-file-summary ${validFile ? 'ready' : ''}`;
        summary.innerHTML = `<strong>${safeName(file.name)}</strong><span>${format || 'Unknown format'} · ${prettySize(file.size)}${validFile ? ' · Ready to preview' : ' · Unsupported format'}</span>`;
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
        const button = $('commitReview');
        if (button) button.textContent = 'Approve & import selected rows';
        renderSteps();
      }
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }

  function wireImport() {
    ensureWizardMarkup();
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

    $('importStatement')?.addEventListener('click', () => {
      state.busy = false;
      window.setTimeout(syncReadyState, 0);
    });
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

  function observeImportErrors() {
    const notice = $('notice');
    if (!notice) return;
    new MutationObserver(() => {
      if (!$('importDialog')?.open || notice.hidden) return;
      if (!String(notice.className || '').includes('error')) return;
      state.busy = false;
      syncReadyState();
      const line = $('importWizardStatus');
      if (line) line.textContent = `Could not preview this statement · ${String(notice.textContent || 'Please check the file and try again.')}`;
    }).observe(notice, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden','class'] });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireImport();
    observeReviewDialog();
    clarifyReviewSummary();
    observeImportErrors();
  });
})();
