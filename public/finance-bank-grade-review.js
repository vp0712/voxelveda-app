(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
  const money = (value, currency='AUD') => new Intl.NumberFormat('en-AU', { style:'currency', currency }).format(Number(value || 0));
  const state = { scope:'ALL', q:'', accountId:'', loading:false };

  async function api(path, options={}) {
    const response = await fetch(path, {
      credentials:'same-origin',
      headers:{ 'Content-Type':'application/json', ...(options.headers || {}) },
      ...options
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showNotice(message, tone='info') {
    const notice = $('notice');
    if (!notice) return;
    notice.hidden = !message;
    notice.className = `notice ${tone}`;
    notice.textContent = message || '';
  }

  function isBalanceMarker(text) {
    const value = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return /^(opening|closing) balance\b/.test(value)
      || /\bbalance (?:brought|carried) forward\b/.test(value)
      || /\bbalance (?:b\/f|c\/f)\b/.test(value);
  }

  function installStyles() {
    if ($('vvBankGradeStyle')) return;
    const style = document.createElement('style');
    style.id = 'vvBankGradeStyle';
    style.textContent = `
      .vv-fix-row{border:0;border-radius:9px;padding:8px 10px;background:#fff4e5;color:#8a4b00;font-weight:800;font-size:.72rem;cursor:pointer}
      .vv-fix-row:disabled{opacity:.55;cursor:not-allowed}
      .vv-lock-note{font-size:.7rem;font-weight:800;color:#7b8496}
      .vv-manual-tag{display:inline-flex;margin-top:5px;padding:4px 7px;border-radius:999px;background:#fff4e5;color:#8a4b00;font-size:.65rem;font-weight:850}
      #vvRejectedEditor{max-width:620px}
      #vvRejectedEditor .vv-override-warning{background:#fff7df;border:1px solid #f4d58b;border-radius:12px;padding:12px;color:#744b00;font-size:.82rem;line-height:1.45;margin-bottom:14px}
      .vv-ledger-panel{overflow:hidden}
      .vv-ledger-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
      .vv-ledger-tabs{display:flex;gap:6px;flex-wrap:wrap}
      .vv-ledger-tab{border:1px solid #dfe5ee;background:#f8fafc;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer;color:#344054}
      .vv-ledger-tab.active{background:#111827;color:#fff;border-color:#111827}
      .vv-ledger-toolbar input,.vv-ledger-toolbar select{min-height:40px;border:1px solid #d7dce3;border-radius:10px;background:#fff;padding:9px 11px;font:inherit}
      .vv-ledger-toolbar input{min-width:220px;flex:1}
      .vv-ledger-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
      .vv-ledger-summary>div{background:#f7f9fc;border:1px solid #e5eaf1;border-radius:12px;padding:12px}
      .vv-ledger-summary span{display:block;color:#667085;font-size:.72rem;margin-bottom:5px}
      .vv-ledger-summary strong{font-size:1.05rem}
      .vv-ledger-list{display:flex;flex-direction:column}
      .vv-tx-row{display:grid;grid-template-columns:130px minmax(220px,1.6fr) 150px 140px 150px 130px;gap:12px;align-items:center;padding:13px 0;border-bottom:1px solid #edf0f4}
      .vv-tx-row:last-child{border-bottom:0}
      .vv-tx-main strong,.vv-tx-main small{display:block}.vv-tx-main small{color:#7b8496;margin-top:4px}
      .vv-tx-amount.out{color:#a12b2b;font-weight:850}.vv-tx-amount.in{color:#176a36;font-weight:850}
      .vv-scope-chip,.vv-source-chip{display:inline-flex;border-radius:999px;padding:5px 8px;font-size:.68rem;font-weight:850;background:#eef1f5;color:#475467}
      .vv-scope-chip.business{background:#eaf8ef;color:#166534}.vv-scope-chip.personal{background:#eef4ff;color:#1d4ed8}.vv-scope-chip.mixed{background:#fff7df;color:#854d0e}
      .vv-source-chip.manual{background:#fff4e5;color:#8a4b00}
      @media(max-width:760px){
        .vv-ledger-summary{grid-template-columns:repeat(2,1fr)}
        .vv-ledger-toolbar{display:grid;grid-template-columns:1fr}.vv-ledger-toolbar input{min-width:0;width:100%}
        .vv-tx-row{display:grid;grid-template-columns:1fr 1fr;background:#fff;border:1px solid #e1e6ed;border-radius:14px;padding:12px;margin-bottom:10px;gap:9px}
        .vv-tx-main{grid-column:1/-1}.vv-tx-row>div:nth-child(1){grid-column:1/-1;color:#667085;font-size:.78rem}
        .vv-tx-amount{text-align:right}.vv-tx-row .vv-source-wrap{grid-column:1/-1}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverrideDialog() {
    if ($('vvRejectedEditor')) return $('vvRejectedEditor');
    const dialog = document.createElement('dialog');
    dialog.id = 'vvRejectedEditor';
    dialog.innerHTML = `
      <form id="vvRejectedForm" class="dialog-form">
        <div class="dialog-head"><div><h2>Fix rejected transaction</h2><p class="helper">Correct the extracted values, then include it safely.</p></div><button id="vvRejectedClose" type="button" class="icon-button">×</button></div>
        <div class="vv-override-warning"><b>Manual override:</b> the original extracted row is preserved in the audit record. Duplicates and opening/closing balances cannot be overridden.</div>
        <input id="vvRejectedRowId" type="hidden">
        <div class="form-grid">
          <label>Date<input id="vvRejectedDate" type="date" required></label>
          <label>Direction<select id="vvRejectedDirection" required><option value="DEBIT">Money out</option><option value="CREDIT">Money in</option></select></label>
        </div>
        <div class="form-grid">
          <label>Amount<input id="vvRejectedAmount" inputmode="decimal" placeholder="0.00" required></label>
          <label>Running balance (optional)<input id="vvRejectedBalance" inputmode="decimal"></label>
        </div>
        <label>Description<input id="vvRejectedDescription" maxlength="500" required></label>
        <div class="form-grid">
          <label>Reference<input id="vvRejectedReference" maxlength="180"></label>
          <label>Category<input id="vvRejectedCategory" maxlength="120"></label>
        </div>
        <label>Why are you including this rejected row?<input id="vvRejectedReason" maxlength="500" required placeholder="Example: PDF column was read incorrectly; verified against statement"></label>
        <div class="dialog-actions"><button id="vvRejectedCancel" type="button">Cancel</button><button id="vvRejectedSave" type="submit" class="primary">Correct & include</button></div>
      </form>`;
    document.body.appendChild(dialog);
    $('vvRejectedClose').addEventListener('click', () => dialog.close());
    $('vvRejectedCancel').addEventListener('click', () => dialog.close());
    $('vvRejectedForm').addEventListener('submit', submitOverride);
    return dialog;
  }

  async function openOverride(rowId) {
    const review = $('reviewDialog');
    const uid = review?.dataset.reviewUid;
    if (!uid) return showNotice('Open the statement review again before correcting a row.', 'error');
    const button = document.querySelector(`.vv-fix-row[data-row-id="${CSS.escape(String(rowId))}"]`);
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    try {
      const payload = await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}`);
      const row = (payload.rows || []).find((item) => String(item.id) === String(rowId));
      if (!row) throw new Error('Statement row could not be loaded.');
      $('vvRejectedRowId').value = row.id;
      $('vvRejectedDate').value = String(row.transaction_date || '').slice(0,10);
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      $('vvRejectedDirection').value = credit > 0 ? 'CREDIT' : 'DEBIT';
      $('vvRejectedAmount').value = String(credit > 0 ? credit : debit || '');
      $('vvRejectedBalance').value = row.running_balance === null || row.running_balance === undefined ? '' : String(row.running_balance);
      $('vvRejectedDescription').value = row.description || row.merchant_name || '';
      $('vvRejectedReference').value = row.reference || '';
      $('vvRejectedCategory').value = row.category || '';
      $('vvRejectedReason').value = '';
      ensureOverrideDialog().showModal();
    } catch (error) {
      showNotice(error.message, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Fix & include'; }
    }
  }

  function updateSummary(summary) {
    if (!summary) return;
    const boxes = $('reviewSummary')?.querySelectorAll('span') || [];
    const values = [summary.total, summary.valid, summary.warning, summary.duplicate, summary.rejected];
    values.forEach((value,index) => { const b=boxes[index]?.querySelector('b'); if (b && value !== undefined) b.textContent=String(value); });
  }

  function updateReviewRow(row) {
    const tr = document.querySelector(`#reviewRows tr[data-review-row-id="${CSS.escape(String(row.id))}"]`);
    if (!tr) return;
    tr.dataset.reviewStatus = row.validation_status;
    tr.dataset.manualOverride = Number(row.manual_override || 0) ? '1' : '0';
    const cells = tr.querySelectorAll('td');
    const checkbox = tr.querySelector('.row-select');
    if (checkbox) { checkbox.disabled = false; checkbox.checked = true; }
    if (cells[1]) cells[1].textContent = String(row.transaction_date || '').slice(0,10);
    if (cells[2]) cells[2].innerHTML = `<strong>${esc(row.description || row.merchant_name || 'No description')}</strong><small>${esc(row.validation_message || '')}</small><span class="vv-manual-tag">Manual override</span>`;
    if (cells[3]) cells[3].textContent = Number(row.debit || 0) ? money(row.debit,row.currency||'AUD') : '—';
    if (cells[4]) cells[4].textContent = Number(row.credit || 0) ? money(row.credit,row.currency||'AUD') : '—';
    if (cells[5]) cells[5].textContent = row.running_balance === null ? '—' : money(row.running_balance,row.currency||'AUD');
    if (cells[6]) cells[6].innerHTML = '<span class="review-status warning">WARNING</span><span class="vv-manual-tag">Corrected</span>';
    tr.querySelector('.vv-fix-row')?.remove();
  }

  async function submitOverride(event) {
    event.preventDefault();
    const review = $('reviewDialog');
    const uid = review?.dataset.reviewUid;
    const rowId = $('vvRejectedRowId').value;
    if (!uid || !rowId) return;
    const save = $('vvRejectedSave');
    save.disabled = true;
    save.textContent = 'Checking correction…';
    try {
      const result = await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}/rows/${encodeURIComponent(rowId)}/override`, {
        method:'POST',
        body:JSON.stringify({
          transaction_date:$('vvRejectedDate').value,
          direction:$('vvRejectedDirection').value,
          amount:$('vvRejectedAmount').value,
          running_balance:$('vvRejectedBalance').value,
          description:$('vvRejectedDescription').value,
          reference:$('vvRejectedReference').value,
          category:$('vvRejectedCategory').value,
          reason:$('vvRejectedReason').value
        })
      });
      updateReviewRow(result.row || {});
      updateSummary(result.summary);
      $('vvRejectedEditor').close();
      showNotice(result.message, 'success');
    } catch (error) {
      showNotice(error.message, error.status === 409 || error.status === 422 ? 'warning' : 'error');
    } finally {
      save.disabled = false;
      save.textContent = 'Correct & include';
    }
  }

  function enhanceReviewRows() {
    const host = $('reviewRows');
    if (!host) return;
    host.querySelectorAll('tr').forEach((tr) => {
      const status = String(tr.dataset.reviewStatus || tr.querySelector('.review-status')?.textContent || '').trim().toUpperCase();
      const description = tr.querySelectorAll('td')[2]?.textContent || '';
      const first = tr.querySelector('td');
      const rowId = tr.dataset.reviewRowId || tr.querySelector('.row-select')?.dataset.rowId;
      if (!first || !rowId) return;
      if (Number(tr.dataset.manualOverride || 0) && !tr.querySelector('.vv-manual-tag')) {
        tr.querySelectorAll('td')[6]?.insertAdjacentHTML('beforeend','<span class="vv-manual-tag">Manual override</span>');
      }
      if (status === 'REJECTED' && !isBalanceMarker(description) && !first.querySelector('.vv-fix-row')) {
        const checkbox = first.querySelector('.row-select');
        if (checkbox) checkbox.style.display='none';
        first.insertAdjacentHTML('beforeend', `<button type="button" class="vv-fix-row" data-row-id="${esc(rowId)}">Fix & include</button>`);
      }
      if (status === 'REJECTED' && isBalanceMarker(description) && !first.querySelector('.vv-lock-note')) {
        first.insertAdjacentHTML('beforeend','<span class="vv-lock-note">Locked balance marker</span>');
      }
      if (status === 'DUPLICATE' && !first.querySelector('.vv-lock-note')) {
        first.insertAdjacentHTML('beforeend','<span class="vv-lock-note">Duplicate locked</span>');
      }
    });
    host.querySelectorAll('.vv-fix-row:not([data-wired])').forEach((button) => {
      button.dataset.wired='1';
      button.addEventListener('click', () => openOverride(button.dataset.rowId));
    });
  }

  function ensureLedgerPanel() {
    if ($('vvTransactionExplorer')) return;
    const anchor = $('bankingSafetyPanel') || $('intelligencePanel');
    if (!anchor) return;
    const section = document.createElement('section');
    section.id='vvTransactionExplorer';
    section.className='panel vv-ledger-panel';
    section.innerHTML=`
      <div class="panel-heading">
        <div><p class="eyebrow">TRANSACTION LEDGER</p><h2>Company and personal transactions — separated</h2><p class="muted">Every imported bank transaction inherits the account owner. Voxel Veda company money and personal money stay separate while All gives you one combined view.</p></div>
        <button id="vvLedgerRefresh" type="button">Refresh</button>
      </div>
      <div class="vv-ledger-toolbar">
        <div class="vv-ledger-tabs">
          <button class="vv-ledger-tab active" data-vv-scope="ALL" type="button">All</button>
          <button class="vv-ledger-tab" data-vv-scope="BUSINESS" type="button">Voxel Veda Company</button>
          <button class="vv-ledger-tab" data-vv-scope="PERSONAL" type="button">Personal</button>
          <button class="vv-ledger-tab" data-vv-scope="MIXED" type="button">Mixed</button>
          <button class="vv-ledger-tab" data-vv-scope="UNCLASSIFIED" type="button">Needs owner</button>
        </div>
        <input id="vvLedgerSearch" type="search" placeholder="Search description, merchant, reference or category">
        <select id="vvLedgerAccount"><option value="">All accounts</option></select>
      </div>
      <div class="vv-ledger-summary">
        <div><span>Transactions</span><strong id="vvLedgerCount">—</strong></div>
        <div><span>Money in</span><strong id="vvLedgerIn">—</strong></div>
        <div><span>Money out</span><strong id="vvLedgerOut">—</strong></div>
        <div><span>Manual overrides</span><strong id="vvLedgerOverrides">—</strong></div>
      </div>
      <div id="vvLedgerList" class="vv-ledger-list"><div class="empty"><strong>Loading ledger…</strong></div></div>`;
    anchor.insertAdjacentElement('beforebegin',section);

    section.querySelectorAll('[data-vv-scope]').forEach((button) => button.addEventListener('click', () => {
      section.querySelectorAll('[data-vv-scope]').forEach((x)=>x.classList.remove('active'));
      button.classList.add('active');
      state.scope=button.dataset.vvScope;
      loadLedger();
    }));
    $('vvLedgerRefresh').addEventListener('click',loadLedger);
    $('vvLedgerAccount').addEventListener('change',()=>{state.accountId=$('vvLedgerAccount').value;loadLedger();});
    let timer;
    $('vvLedgerSearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{state.q=$('vvLedgerSearch').value.trim();loadLedger();},280);});
  }

  async function loadLedgerAccounts() {
    const result=await api('/api/finance/intelligence/accounts');
    const select=$('vvLedgerAccount');
    if (!select) return;
    const value=select.value;
    select.innerHTML='<option value="">All accounts</option>'+ (result.bank_accounts||[]).filter((a)=>a.status==='ACTIVE').map((a)=>`<option value="${a.id}">${esc(a.nickname)} · ${esc(a.ownership_scope)}</option>`).join('');
    if ([...select.options].some((o)=>o.value===value)) select.value=value;
  }

  function scopeLabel(scope) {
    return scope==='BUSINESS'?'Voxel Veda Company':scope==='PERSONAL'?'Personal':scope==='MIXED'?'Mixed':'Needs owner';
  }

  function renderLedger(payload) {
    $('vvLedgerCount').textContent=String(payload.total||0);
    $('vvLedgerIn').textContent=money(payload.summary?.money_in||0);
    $('vvLedgerOut').textContent=money(payload.summary?.money_out||0);
    $('vvLedgerOverrides').textContent=String(payload.summary?.manual_overrides||0);
    const rows=payload.transactions||[];
    $('vvLedgerList').innerHTML=rows.length?rows.map((row)=>{
      const currency=row.currency||'AUD';
      const out=Number(row.debit||0);
      const incoming=Number(row.credit||0);
      const source=row.source_type==='STATEMENT_IMPORT'?'Statement':(row.source_provider||row.source_type||'Bank');
      return `<article class="vv-tx-row">
        <div>${esc(String(row.transaction_date||'').slice(0,10))}</div>
        <div class="vv-tx-main"><strong>${esc(row.description||row.merchant_name||'Transaction')}</strong><small>${esc(row.account_name||'Account')} · ${esc(row.category||'Unclassified')} · ${esc(row.reconciliation_status||'UNRECONCILED')}</small></div>
        <div><span class="vv-scope-chip ${esc(String(row.ownership_scope||'').toLowerCase())}">${esc(scopeLabel(row.ownership_scope))}</span></div>
        <div class="vv-tx-amount ${out>0?'out':'in'}">${out>0?'- '+money(out,currency):'+ '+money(incoming,currency)}</div>
        <div>${row.running_balance===null||row.running_balance===undefined?'—':money(row.running_balance,currency)}</div>
        <div class="vv-source-wrap"><span class="vv-source-chip ${Number(row.manual_override||0)?'manual':''}">${Number(row.manual_override||0)?'Manual override':esc(source)}</span></div>
      </article>`;
    }).join(''):'<div class="empty"><strong>No transactions in this view</strong><span>Import a statement or change the filter.</span></div>';
  }

  async function loadLedger() {
    if (state.loading || !$('vvLedgerList')) return;
    state.loading=true;
    $('vvLedgerList').setAttribute('aria-busy','true');
    try {
      const params=new URLSearchParams({scope:state.scope,limit:'100'});
      if (state.q) params.set('q',state.q);
      if (state.accountId) params.set('account_id',state.accountId);
      renderLedger(await api(`/api/finance/intelligence/transactions?${params.toString()}`));
    } catch (error) {
      $('vvLedgerList').innerHTML=`<div class="empty"><strong>Could not load transactions</strong><span>${esc(error.message)}</span></div>`;
    } finally {
      state.loading=false;
      $('vvLedgerList')?.removeAttribute('aria-busy');
    }
  }

  function init() {
    installStyles();
    ensureOverrideDialog();
    ensureLedgerPanel();
    loadLedgerAccounts().then(loadLedger).catch((error)=>showNotice(error.message,'error'));
    const rows=$('reviewRows');
    if (rows) {
      new MutationObserver(()=>setTimeout(enhanceReviewRows,0)).observe(rows,{childList:true,subtree:true});
      enhanceReviewRows();
    }
    const notice=$('notice');
    if (notice) new MutationObserver(()=>{
      const text=String(notice.textContent||'');
      if (!notice.hidden && /statement transactions committed|already imported successfully/i.test(text)) {
        loadLedgerAccounts().then(loadLedger).catch(()=>{});
      }
    }).observe(notice,{childList:true,attributes:true,attributeFilter:['hidden','class']});
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();