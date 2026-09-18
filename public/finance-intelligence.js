(() => {
  const state = { scope: 'ALL', accounts: [], activeReview: null };
  const FIN_PREFIX = location.pathname === '/banking' ? '/api/banking/intelligence' : '/api/finance/intelligence';
  const $ = (id) => document.getElementById(id);
  const money = (value, currency = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  const dateText = (value) => value ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : 'Unknown';

  function notice(message, tone = 'info') {
    const el = $('notice');
    el.hidden = !message;
    el.className = `notice ${tone}`;
    el.textContent = message || '';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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

  function renderAccounts(accounts) {
    const host = $('accounts');
    if (!accounts.length) {
      host.innerHTML = '<div class="empty"><strong>No accounts yet</strong><span>Add your personal or business account, then import its statement.</span></div>';
      return;
    }
    host.innerHTML = accounts.map((account) => `
      <article class="account-card">
        <div class="account-top"><span class="scope-tag ${String(account.ownership_scope || '').toLowerCase()}">${escapeHtml(account.ownership_scope || 'UNCLASSIFIED')}</span><span class="status-dot">${escapeHtml(account.connection_status || 'MANUAL')}</span></div>
        <h3>${escapeHtml(account.nickname || 'Account')}</h3>
        <p>${escapeHtml(account.institution || 'Manual account')} · ${escapeHtml(account.account_number_masked || 'number not stored')}</p>
        <strong>${money(account.available_balance ?? account.current_ledger_balance, account.currency || 'AUD')}</strong>
        <div class="account-meta"><span>${Number(account.transaction_count || 0)} transactions</span><span>${Number(account.unreconciled_count || 0)} unreconciled</span></div>
        <small>History: ${dateText(account.history_start_date || account.imported_history_start)} → ${dateText(account.history_end_date || account.imported_history_end)}</small>
      </article>`).join('');
  }

  function renderCategories(rows) {
    $('categories').innerHTML = rows.length ? rows.map((row) => `
      <div class="data-row"><div><strong>${escapeHtml(row.category)}</strong><small>${Number(row.transaction_count || 0)} transactions</small></div><b>${money(row.amount)}</b></div>`).join('') : '<p class="muted">Import transactions to see spending categories.</p>';
  }

  function renderQuality(issues) {
    const entries = [
      ['Unclassified transactions', issues.unclassified_transactions],
      ['Unreconciled transactions', issues.unreconciled_transactions],
      ['Missing ownership', issues.ownership_missing],
      ['Disconnected bank feeds', issues.disconnected_accounts],
      ['Unknown history coverage', issues.unknown_history_coverage]
    ];
    $('quality').innerHTML = entries.map(([name, value]) => `<div class="data-row"><span>${name}</span><b>${Number(value || 0)}</b></div>`).join('');
  }

  function renderCoverage(accounts) {
    $('coverage').innerHTML = accounts.length ? accounts.map((account) => `
      <div class="data-row coverage-row">
        <div><strong>${escapeHtml(account.nickname)}</strong><small>${escapeHtml(account.ownership_scope || '')} · ${escapeHtml(account.connection_type || 'MANUAL')}</small></div>
        <div class="right"><b>${dateText(account.transaction_start || account.history_start_date)} → ${dateText(account.transaction_end || account.history_end_date)}</b><small>${Number(account.statement_rows || 0)} statement · ${Number(account.open_banking_rows || 0)} bank-feed rows</small></div>
      </div>`).join('') : '<p class="muted">No account history available yet.</p>';
  }

  function renderWarehouse(warehouse) {
    const totals=warehouse?.totals||{};
    if($('warehouseTotals')) $('warehouseTotals').innerHTML =
      '<div><span>Bank accounts</span><strong>'+Number(totals.accounts||0)+'</strong><small>Kept separate</small></div>'+
      '<div><span>Approved statements</span><strong>'+Number(totals.statements||0)+'</strong><small>Permanent history</small></div>'+
      '<div><span>Transactions</span><strong>'+Number(totals.transactions||0)+'</strong><small>Across all statements</small></div>'+
      '<div><span>Currency handling</span><strong>Separate</strong><small>No false FX totals</small></div>';

    const curHost=$('warehouseCurrencies');
    if(curHost){
      const rows=warehouse?.summary_by_currency||[];
      curHost.innerHTML=rows.length?rows.map(s=>`
        <article class="warehouse-currency-card">
          <div class="warehouse-currency-head"><div><span>CURRENCY</span><strong>${escapeHtml(s.currency)}</strong></div><div><span>Bank net position</span><strong>${money(s.bank_net_position,s.currency)}</strong></div></div>
          <div class="warehouse-currency-grid">
            <div><span>Money in</span><b>${money(s.money_in,s.currency)}</b></div>
            <div><span>Money out</span><b>${money(s.money_out,s.currency)}</b></div>
            <div><span>Net cash flow</span><b>${money(s.net_flow,s.currency)}</b></div>
            <div><span>Cash in</span><b>${money(s.cash_in,s.currency)}</b></div>
            <div><span>Cash out</span><b>${money(s.cash_out,s.currency)}</b></div>
            <div><span>Transactions</span><b>${Number(s.transactions||0)}</b></div>
            <div><span>Needs category</span><b>${Number(s.needs_category||0)}</b></div>
            <div><span>History</span><b>${escapeHtml(String(s.first_transaction||'').slice(0,10)||'—')} → ${escapeHtml(String(s.last_transaction||'').slice(0,10)||'—')}</b></div>
          </div>
        </article>`).join(''):'<div class="empty"><strong>No approved statement history yet.</strong><span>Add an account and upload its first statement.</span></div>';
    }

    const aHost=$('warehouseAccounts');
    if(aHost){
      const accounts=warehouse?.accounts||[];
      aHost.innerHTML=accounts.length?accounts.map(a=>`
        <div class="warehouse-row">
          <div><strong>${escapeHtml(a.nickname||'Account')}</strong><small>${escapeHtml(a.institution||'Bank')} · ${escapeHtml(a.currency||'AUD')} · ${escapeHtml(a.ownership_scope||'')}</small></div>
          <div class="right"><b>${Number(a.statement_count||0)} statements</b><small>${Number(a.transaction_count||0)} transactions · ${dateText(a.history_start_date)} → ${dateText(a.history_end_date)}</small>
            <div class="warehouse-actions">
              <button type="button" data-clear-account-history="${Number(a.id)}" data-account-name="${escapeHtml(a.nickname||'Account')}">Clear statement history</button>
              <button type="button" data-archive-account="${Number(a.id)}" data-account-name="${escapeHtml(a.nickname||'Account')}">Archive account</button>
            </div>
          </div>
        </div>`).join(''):'<p class="muted">No accounts yet.</p>';
      aHost.querySelectorAll('[data-clear-account-history]').forEach(b=>b.addEventListener('click',()=>clearAccountHistory(Number(b.dataset.clearAccountHistory),b.dataset.accountName)));
      aHost.querySelectorAll('[data-archive-account]').forEach(b=>b.addEventListener('click',()=>archiveBankAccount(Number(b.dataset.archiveAccount),b.dataset.accountName)));
    }

    const sHost=$('warehouseStatements');
    if(sHost){
      const statements=warehouse?.statements||[];
      sHost.innerHTML=statements.length?statements.slice(0,20).map(s=>`
        <div class="warehouse-row">
          <div><strong>${escapeHtml(s.original_name||'Statement')}</strong><small>${escapeHtml(s.account_name||'Account')} · ${escapeHtml(s.currency||'AUD')} · ${escapeHtml(s.source_format||'')}</small></div>
          <div class="right"><b>${Number(s.imported_rows||0)} rows</b><small>${escapeHtml(String(s.statement_start_date||'').slice(0,10)||'—')} → ${escapeHtml(String(s.statement_end_date||'').slice(0,10)||'—')} · ${Number(s.duplicate_rows||0)} duplicates</small></div>
        </div>`).join(''):'<p class="muted">No approved statements yet.</p>';
    }
  }

  async function clearAccountHistory(accountId,name){
    const typed=prompt(`This removes every imported statement from "${name||'this account'}" from reports and analysis. It is reversible from Removed Statements.\n\nType CLEAR to continue.`);
    if(typed!=='CLEAR')return;
    try{
      const p=await api(`${FIN_PREFIX}/accounts/${accountId}/clear-statements`,{method:'POST',body:'{}'});
      notice(p.message||'Statement history cleared.','success');
      await load();
      document.getElementById('vvRefreshStatements')?.click();
    }catch(error){notice(error.message,'error');}
  }

  async function archiveBankAccount(accountId,name){
    if(!confirm(`Archive "${name||'this account'}"?\n\nIts history is preserved, but it will be removed from active analysis until restored.`))return;
    try{
      const p=await api(`${FIN_PREFIX}/accounts/${accountId}/archive`,{method:'POST',body:'{}'});
      notice(p.message||'Account archived.','success');
      await load();
    }catch(error){notice(error.message,'error');}
  }

  function populateAccountSelect() {
    $('importAccount').innerHTML = state.accounts.filter((account) => account.status === 'ACTIVE').map((account) => `<option value="${account.id}" data-currency="${escapeHtml(account.currency || 'AUD')}">${escapeHtml(account.nickname)} · ${escapeHtml(account.institution || 'Bank')} · ${escapeHtml(account.currency || 'AUD')} · ${escapeHtml(account.ownership_scope)}</option>`).join('');
  }

  async function load() {
    notice('');
    try {
      const [overview, quality, coverage, connection, accounts, warehouse] = await Promise.all([
        api(`${FIN_PREFIX}/overview?scope=${encodeURIComponent(state.scope)}`),
        api(FIN_PREFIX + '/data-quality'),
        api(FIN_PREFIX + '/history-coverage'),
        api(FIN_PREFIX + '/bank-connections'),
        api(FIN_PREFIX + '/accounts'),
        api(`${FIN_PREFIX}/statement-warehouse?scope=${encodeURIComponent(state.scope)}`)
      ]);
      renderWarehouse(warehouse);
      renderAccounts(overview.accounts);
      renderCategories(overview.spending_by_category || []);
      renderQuality(quality.issues || {});
      renderCoverage(coverage.accounts || []);
      state.accounts = accounts.bank_accounts || [];
      populateAccountSelect();
      $('providerBadge').textContent = connection.configured ? `${connection.provider} configured` : 'Bank feed not configured';
      $('providerBadge').classList.toggle('ok', Boolean(connection.configured));
    } catch (error) {
      if (error.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      notice(error.message, 'error');
    }
  }

  function csvSplit(line) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { values.push(value.trim()); value = ''; }
      else value += ch;
    }
    values.push(value.trim());
    return values;
  }

  function parseNumber(input) {
    const cleaned = String(input || '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const parsed = Number(cleaned || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new Error('CSV must contain a header row and at least one transaction.');
    const headers = csvSplit(lines.shift()).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const aliases = {
      transaction_date: ['transaction_date', 'date', 'transactiondate', 'value_date', 'processed_date'],
      posting_date: ['posting_date', 'posted_date', 'process_date'],
      description: ['description', 'details', 'transaction_details', 'narrative', 'memo'],
      reference: ['reference', 'ref', 'transaction_reference'],
      debit: ['debit', 'withdrawal', 'withdrawals', 'money_out', 'debits'],
      credit: ['credit', 'deposit', 'deposits', 'money_in', 'credits'],
      amount: ['amount', 'transaction_amount'],
      running_balance: ['running_balance', 'balance', 'account_balance'],
      merchant_name: ['merchant', 'merchant_name', 'payee'],
      category: ['category'],
      currency: ['currency']
    };
    const indexOf = (key) => {
      for (const alias of aliases[key] || []) {
        const index = headers.indexOf(alias);
        if (index >= 0) return index;
      }
      return -1;
    };
    const idx = Object.fromEntries(Object.keys(aliases).map((key) => [key, indexOf(key)]));
    if (idx.transaction_date < 0) throw new Error('Statement needs a transaction date column.');
    if (idx.amount < 0 && idx.debit < 0 && idx.credit < 0) throw new Error('Statement needs Amount or Debit/Credit columns.');
    return lines.map((line) => {
      const cells = csvSplit(line);
      let debit = idx.debit >= 0 ? Math.abs(parseNumber(cells[idx.debit])) : 0;
      let credit = idx.credit >= 0 ? Math.abs(parseNumber(cells[idx.credit])) : 0;
      if (idx.amount >= 0 && !debit && !credit) {
        const raw = parseNumber(cells[idx.amount]);
        if (raw < 0) debit = Math.abs(raw); else if (raw > 0) credit = raw;
      }
      return {
        transaction_date: cells[idx.transaction_date],
        posting_date: idx.posting_date >= 0 ? cells[idx.posting_date] : null,
        description: idx.description >= 0 ? cells[idx.description] : '',
        reference: idx.reference >= 0 ? cells[idx.reference] : '',
        debit, credit,
        running_balance: idx.running_balance >= 0 ? cells[idx.running_balance] : null,
        merchant_name: idx.merchant_name >= 0 ? cells[idx.merchant_name] : null,
        category: idx.category >= 0 ? cells[idx.category] : null,
        currency: idx.currency >= 0 ? cells[idx.currency] : null
      };
    });
  }

  function ofxTag(block, name) {
    const match = block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  function parseOfx(text) {
    const blocks = String(text || '').match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
    if (!blocks.length) throw new Error('No OFX/QFX transactions were found.');
    return blocks.map((block) => {
      const amount = parseNumber(ofxTag(block, 'TRNAMT'));
      const posted = ofxTag(block, 'DTPOSTED').slice(0, 8);
      const date = /^\d{8}$/.test(posted) ? `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}` : posted;
      const name = ofxTag(block, 'NAME');
      const memo = ofxTag(block, 'MEMO');
      return {
        transaction_date: date,
        description: [name, memo].filter(Boolean).join(' · '),
        merchant_name: name || null,
        reference: ofxTag(block, 'FITID') || ofxTag(block, 'REFNUM') || null,
        debit: amount < 0 ? Math.abs(amount) : 0,
        credit: amount > 0 ? amount : 0,
        running_balance: null,
        currency: null
      };
    });
  }

  function normalizeQifDate(value) {
    const input = String(value || '').trim().replace(/'/g, '/');
    const parts = input.split(/[\/.-]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 3) return input;
    let [a, b, c] = parts;
    let year = Number(c);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const first = Number(a); const second = Number(b);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseQif(text) {
    const records = String(text || '').split(/^\^\s*$/m).map((record) => record.trim()).filter(Boolean);
    const rows = [];
    for (const record of records) {
      const fields = {};
      for (const line of record.split(/\r?\n/)) {
        const code = line[0];
        if (!code || code === '!') continue;
        fields[code] = String(line.slice(1)).trim();
      }
      if (!fields.D || fields.T === undefined) continue;
      const amount = parseNumber(fields.T);
      rows.push({
        transaction_date: normalizeQifDate(fields.D),
        description: [fields.P, fields.M].filter(Boolean).join(' · '),
        merchant_name: fields.P || null,
        reference: fields.N || null,
        debit: amount < 0 ? Math.abs(amount) : 0,
        credit: amount > 0 ? amount : 0,
        running_balance: null,
        category: fields.L || null,
        currency: null
      });
    }
    if (!rows.length) throw new Error('No QIF transactions were found.');
    return rows;
  }

  async function parseXlsx(file) {
    if (!window.XLSX) throw new Error('XLSX parser failed to load. Use CSV or try again after refreshing.');
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('The spreadsheet has no readable sheet.');
    return parseCsv(window.XLSX.utils.sheet_to_csv(firstSheet));
  }

  async function pdfLines(file) {
    if (!window.pdfjsLib) throw new Error('PDF parser failed to load. Use a CSV/OFX export or refresh and try again.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const groups = new Map();
      for (const item of content.items || []) {
        const y = Math.round(Number(item.transform?.[5] || 0) / 3) * 3;
        if (!groups.has(y)) groups.set(y, []);
        groups.get(y).push({ x: Number(item.transform?.[4] || 0), text: String(item.str || '').trim() });
      }
      [...groups.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
        const line = items.sort((a, b) => a.x - b.x).map((item) => item.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
      });
    }
    return lines;
  }

  function parsePdfLines(lines) {
    const datePattern = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}\b)/;
    const amountPattern = /(?:CR|DR)?\s*[-+]?\(?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?/gi;
    const rows = [];
    for (const line of lines) {
      const dateMatch = line.match(datePattern);
      if (!dateMatch) continue;
      const amounts = [...line.matchAll(amountPattern)].map((match) => ({ raw: match[0], index: match.index || 0 }));
      if (!amounts.length) continue;
      const transactionAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
      const balanceAmount = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
      const rawAmount = transactionAmount.raw;
      const numeric = Math.abs(parseNumber(rawAmount.replace(/\b(?:CR|DR)\b/gi, '')));
      const debitHint = /\bDR\b/i.test(rawAmount) || /^\s*-/.test(rawAmount) || /^\s*\(/.test(rawAmount);
      const creditHint = /\bCR\b/i.test(rawAmount) || /^\s*\+/.test(rawAmount);
      if (!debitHint && !creditHint) continue;
      const description = line.slice(dateMatch.index + dateMatch[0].length, transactionAmount.index).trim();
      rows.push({
        transaction_date: dateMatch[0],
        description: description || 'PDF statement transaction — verify description',
        debit: debitHint ? numeric : 0,
        credit: creditHint ? numeric : 0,
        running_balance: balanceAmount ? Math.abs(parseNumber(balanceAmount.raw.replace(/\b(?:CR|DR)\b/gi, ''))) : null,
        reference: null,
        merchant_name: null,
        category: null,
        currency: null
      });
    }
    if (!rows.length) throw new Error('This PDF does not expose transaction direction safely enough for automatic import. Export CSV/OFX from the bank, or use a PDF with explicit CR/DR or signed amounts. Nothing was imported.');
    return rows;
  }

  async function parseStatement(file) {
    const extension = (file.name.split('.').pop() || '').toUpperCase();
    if (extension === 'CSV') return { format: extension, rows: parseCsv(await file.text()) };
    if (extension === 'OFX' || extension === 'QFX') return { format: extension, rows: parseOfx(await file.text()) };
    if (extension === 'QIF') return { format: extension, rows: parseQif(await file.text()) };
    if (extension === 'XLSX') return { format: extension, rows: await parseXlsx(file) };
    if (extension === 'PDF') return { format: extension, rows: parsePdfLines(await pdfLines(file)) };
    throw new Error('Unsupported statement file. Use CSV, PDF, OFX, QFX, QIF or XLSX.');
  }

  async function sha256(file) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function connectBank() {
    try {
      const result = await api(FIN_PREFIX + '/bank-connections/connect', { method: 'POST', body: '{}' });
      notice(result.message || 'Bank connection started.', 'success');
    } catch (error) {
      notice(error.message, error.code === 'BANK_PROVIDER_NOT_CONFIGURED' ? 'warning' : 'error');
    }
  }

  function statusClass(status) {
    return `review-status ${String(status || '').toLowerCase()}`;
  }

  async function openReview(uid) {
    const result = await api(`${FIN_PREFIX}/statement-reviews/${encodeURIComponent(uid)}`);
    state.activeReview = result;
    const session = result.session;
    $('reviewDialog').dataset.reviewUid = session.import_uid;
    $('reviewSubtitle').textContent = `${session.original_name} · ${session.account_name} · ${session.source_format} · ${session.status}`;
    $('reviewSummary').innerHTML = `
      <span><b>${Number(session.total_rows || 0)}</b> total</span>
      <span><b>${Number(session.valid_rows || 0)}</b> valid</span>
      <span><b>${Number(session.warning_rows || 0)}</b> warnings</span>
      <span><b>${Number(session.duplicate_rows || 0)}</b> duplicates</span>
      <span><b>${Number(session.rejected_rows || 0)}</b> rejected</span>`;
    $('reviewRows').innerHTML = (result.rows || []).map((row) => `
      <tr data-review-row-id="${row.id}" data-review-status="${escapeHtml(row.validation_status)}" data-manual-override="${Number(row.manual_override || 0) ? '1' : '0'}">
        <td><input type="checkbox" class="row-select" data-row-id="${row.id}" ${Number(row.selected) ? 'checked' : ''} ${row.validation_status === 'REJECTED' ? 'disabled' : ''}></td>
        <td>${escapeHtml(String(row.transaction_date || '').slice(0, 10))}</td>
        <td><strong>${escapeHtml(row.description || row.merchant_name || 'No description')}</strong>${row.validation_message ? `<small>${escapeHtml(row.validation_message)}</small>` : ''}</td>
        <td>${Number(row.debit || 0) ? money(row.debit, row.currency || session.account_currency || 'AUD') : '—'}</td>
        <td>${Number(row.credit || 0) ? money(row.credit, row.currency || session.account_currency || 'AUD') : '—'}</td>
        <td>${row.running_balance === null ? '—' : money(row.running_balance, row.currency || session.account_currency || 'AUD')}</td>
        <td><span class="${statusClass(row.validation_status)}">${escapeHtml(row.validation_status)}</span></td>
      </tr>`).join('');
    document.querySelectorAll('.row-select').forEach((checkbox) => checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        await api(`${FIN_PREFIX}/statement-reviews/${encodeURIComponent(session.import_uid)}/rows/${checkbox.dataset.rowId}/select`, {
          method: 'POST', body: JSON.stringify({ selected: checkbox.checked })
        });
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        notice(error.message, 'error');
      } finally { checkbox.disabled = false; }
    }));
    $('commitReview').disabled = session.status !== 'PENDING_REVIEW';
    $('rejectReview').disabled = session.status !== 'PENDING_REVIEW';
    $('reviewDialog').showModal();
  }

  async function loadReviewQueue() {
    const result = await api(FIN_PREFIX + '/statement-reviews');
    const sessions = result.sessions || [];
    $('reviewQueue').innerHTML = sessions.length ? sessions.map((session) => `
      <button type="button" class="queue-row" data-review-uid="${escapeHtml(session.import_uid)}">
        <div><strong>${escapeHtml(session.original_name)}</strong><small>${escapeHtml(session.account_name)} · ${escapeHtml(session.source_format)} · ${dateText(session.created_at)}</small></div>
        <div class="right"><span class="${statusClass(session.status)}">${escapeHtml(session.status)}</span><small>${Number(session.total_rows || 0)} rows · ${Number(session.warning_rows || 0)} warnings</small></div>
      </button>`).join('') : '<p class="muted">No statement review sessions yet.</p>';
    document.querySelectorAll('[data-review-uid]').forEach((button) => button.addEventListener('click', async () => {
      $('queueDialog').close();
      try { await openReview(button.dataset.reviewUid); } catch (error) { notice(error.message, 'error'); }
    }));
    $('queueDialog').showModal();
  }

  $('accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.currency = String(payload.currency || 'AUD').toUpperCase();
    try {
      const result = await api(FIN_PREFIX + '/accounts', { method: 'POST', body: JSON.stringify(payload) });
      $('accountDialog').close();
      event.currentTarget.reset();
      notice(result.message, 'success');
      await load();
    } catch (error) { notice(error.message, 'error'); }
  });

  $('importForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const accountId = Number($('importAccount').value);
    const files = [...($('importFile').files || [])];
    if (!accountId || !files.length) return;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const status=$('importBatchStatus');
    submit.disabled = true;
    submit.textContent = files.length>1 ? 'Parsing statements…' : 'Parsing…';
    const selectedAccount = state.accounts.find((account) => Number(account.id) === accountId);
    const accountCurrency = String(selectedAccount?.currency || $('importAccount').selectedOptions?.[0]?.dataset?.currency || 'AUD').toUpperCase();
    const staged=[]; const failures=[];
    try {
      for(let i=0;i<files.length;i+=1){
        const file=files[i];
        if(status) status.textContent=`Reading ${i+1} of ${files.length}: ${file.name}`;
        try{
          const parsed = await parseStatement(file);
          parsed.rows = (parsed.rows || []).map((row) => ({ ...row, currency: String(row.currency || accountCurrency).toUpperCase() }));
          const result = await api(`${FIN_PREFIX}/accounts/${accountId}/statements/preview`, {
            method:'POST',
            body:JSON.stringify({ source_format:parsed.format, original_name:file.name, content_hash:await sha256(file), rows:parsed.rows })
          });
          staged.push({file:file.name,result});
        }catch(error){
          failures.push({file:file.name,message:error.message});
        }
      }
      event.currentTarget.reset();
      if(status) status.textContent='';
      const successText=`${staged.length} statement${staged.length===1?'':'s'} staged for review`;
      const failureText=failures.length?` · ${failures.length} could not be staged`:'';
      notice(successText+failureText, failures.length?'warning':'success');
      if(staged.length===1 && !failures.length){
        $('importDialog').close();
        await openReview(staged[0].result.import_uid);
      }else{
        $('importDialog').close();
        await loadReviewQueue();
      }
    } finally {
      submit.disabled = false;
      submit.textContent = 'Parse & review';
      if(status && !status.textContent.includes('could not')) status.textContent='';
      await load();
    }
  });

  $('commitReview').addEventListener('click', async () => {
    const uid = state.activeReview?.session?.import_uid;
    if (!uid) return;
    try {
      const result = await api(`${FIN_PREFIX}/statement-reviews/${encodeURIComponent(uid)}/commit`, { method: 'POST', body: '{}' });
      $('reviewDialog').close();
      notice(result.message, 'success');
      await load();
    } catch (error) { notice(error.message, 'error'); }
  });

  $('rejectReview').addEventListener('click', async () => {
    const uid = state.activeReview?.session?.import_uid;
    if (!uid) return;
    const reason = window.prompt('Reason for rejecting this statement review:');
    if (!reason) return;
    try {
      const result = await api(`${FIN_PREFIX}/statement-reviews/${encodeURIComponent(uid)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      $('reviewDialog').close();
      notice(result.message, 'success');
    } catch (error) { notice(error.message, 'error'); }
  });

  document.querySelectorAll('.scope').forEach((button) => button.addEventListener('click', async () => {
    document.querySelectorAll('.scope').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.scope = button.dataset.scope;
    await load();
  }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('connectBank').addEventListener('click', connectBank);
  $('addAccount').addEventListener('click', () => $('accountDialog').showModal());
  $('importStatement').addEventListener('click', () => $('importDialog').showModal());
  $('openReviewQueue').addEventListener('click', () => loadReviewQueue().catch((error) => notice(error.message, 'error')));
  $('refreshDashboard').addEventListener('click', load);
  $('warehouseOpenReport')?.addEventListener('click',()=>document.getElementById('vvOverallReport')?.click());

  function escapeHtml(input) {
    return String(input ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  load();
})();
