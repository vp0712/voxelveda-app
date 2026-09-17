'use strict';

(() => {
  const VERSION = '20260918-pdf-parser2';
  const $ = (id) => document.getElementById(id);
  const moneyPattern = /(?:CR|DR)?\s*[-+]?\(?\$?\d[\d,]*\.\d{2}\)?(?:\s*(?:CR|DR))?/gi;
  const fullDatePattern = /(\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b)/i;
  const shortDatePattern = /\b\d{1,2}\s+[A-Za-z]{3,9}\b/i;
  let activeReviewUid = null;
  let installing = false;

  function text(value) { return String(value ?? '').trim(); }
  function normal(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[ch])); }
  function parseMoney(value) {
    const cleaned = text(value).replace(/\b(?:CR|DR)\b/gi, '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function absMoney(value) { const parsed = parseMoney(value); return parsed === null ? null : Math.abs(parsed); }
  function near(a, b, tolerance = 0.03) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance; }
  function balanceMarker(value) {
    const v = normal(value);
    return /^(opening|closing|available|current) balance\b/.test(v)
      || /\bbalance (?:brought|carried) forward\b/.test(v)
      || /\bbalance (?:b f|c f)\b/.test(v);
  }

  function monthNumber(value) {
    const names = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const idx = names.indexOf(text(value).slice(0, 3).toLowerCase());
    return idx >= 0 ? idx + 1 : 0;
  }

  function normaliseDate(raw, fallbackYear) {
    const value = text(raw);
    let m = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      return `${year}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
    m = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?$/);
    if (m) {
      const month = monthNumber(m[2]);
      let year = Number(m[3] || fallbackYear || new Date().getFullYear());
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      if (month) return `${year}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    }
    return value;
  }

  function lineFromItems(items, pageNo, y) {
    const ordered = items.filter((item) => text(item.str)).map((item) => ({
      x: Number(item.transform?.[4] || 0),
      width: Math.max(1, Number(item.width || 0)),
      text: text(item.str)
    })).sort((a, b) => a.x - b.x);
    let joined = '';
    const segments = [];
    ordered.forEach((item) => {
      if (joined) joined += ' ';
      const start = joined.length;
      joined += item.text;
      segments.push({ start, end: joined.length, x: item.x, width: item.width, text: item.text });
    });
    return { page: pageNo, y, text: joined.replace(/\s+/g, ' ').trim(), segments };
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF reader is not available. Refresh the app once and try the PDF again.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const groups = new Map();
      for (const item of content.items || []) {
        const y = Math.round(Number(item.transform?.[5] || 0) / 2) * 2;
        if (!groups.has(y)) groups.set(y, []);
        groups.get(y).push(item);
      }
      [...groups.entries()].sort((a, b) => b[0] - a[0]).forEach(([y, items]) => {
        const line = lineFromItems(items, pageNo, y);
        if (line.text) lines.push(line);
      });
    }
    if (!lines.length) throw new Error('This PDF contains no readable text layer. Download a text-based statement PDF, CSV, OFX or QFX from your bank.');
    return lines;
  }

  function segmentX(line, charIndex) {
    const segment = line.segments.find((part) => charIndex >= part.start && charIndex <= part.end)
      || line.segments.slice().reverse().find((part) => part.start <= charIndex)
      || line.segments[0];
    return segment ? segment.x : 0;
  }

  function phraseX(line, phrases) {
    const joined = normal(line.text);
    for (const phrase of phrases) {
      if (!joined.includes(phrase)) continue;
      const words = phrase.split(' ');
      for (let i = 0; i < line.segments.length; i += 1) {
        const run = normal(line.segments.slice(i, i + words.length + 1).map((part) => part.text).join(' '));
        if (run.startsWith(phrase) || normal(line.segments[i].text) === phrase) return line.segments[i].x;
      }
    }
    return null;
  }

  function detectColumns(lines) {
    const columns = { debit: null, credit: null, balance: null, amount: null };
    for (const line of lines) {
      const n = normal(line.text);
      if (!/(debit|credit|withdraw|deposit|money out|money in|balance|amount)/.test(n)) continue;
      columns.debit ??= phraseX(line, ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out']);
      columns.credit ??= phraseX(line, ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in']);
      columns.balance ??= phraseX(line, ['running balance', 'account balance', 'balance']);
      columns.amount ??= phraseX(line, ['transaction amount', 'amount']);
      if ((columns.debit !== null || columns.credit !== null) && columns.balance !== null) break;
    }
    return columns;
  }

  function monetaryMatches(line) {
    return [...line.text.matchAll(moneyPattern)].map((match) => {
      const raw = match[0];
      const signed = parseMoney(raw);
      return {
        raw,
        index: match.index || 0,
        x: segmentX(line, match.index || 0),
        value: signed === null ? 0 : Math.abs(signed),
        explicitDebit: /\bDR\b/i.test(raw) || /^\s*-/.test(raw) || /^\s*\(/.test(raw),
        explicitCredit: /\bCR\b/i.test(raw) || /^\s*\+/.test(raw)
      };
    }).filter((amount) => amount.value > 0 || /0\.00/.test(amount.raw));
  }

  function closestAmount(amounts, x, excluded = new Set()) {
    if (x === null || x === undefined) return null;
    const pool = amounts.filter((amount) => !excluded.has(amount));
    if (!pool.length) return null;
    return pool.reduce((best, amount) => Math.abs(amount.x - x) < Math.abs(best.x - x) ? amount : best, pool[0]);
  }

  function candidateFromLine(line, columns, fallbackYear) {
    const dateMatch = line.text.match(fullDatePattern) || line.text.match(shortDatePattern);
    if (!dateMatch) return null;
    const amounts = monetaryMatches(line);
    if (!amounts.length) return null;
    const descriptionStart = (dateMatch.index || 0) + dateMatch[0].length;
    const firstAmountIndex = Math.min(...amounts.map((amount) => amount.index));
    const description = line.text.slice(descriptionStart, firstAmountIndex).trim().replace(/^[-–—|:]+|[-–—|:]+$/g, '').trim();
    if (balanceMarker(description) || balanceMarker(line.text.slice(descriptionStart))) return { marker: true, line, balance: amounts.at(-1)?.value ?? null };

    const used = new Set();
    let debitAmount = closestAmount(amounts, columns.debit, used);
    if (debitAmount && Math.abs(debitAmount.x - columns.debit) > 80) debitAmount = null;
    if (debitAmount) used.add(debitAmount);
    let creditAmount = closestAmount(amounts, columns.credit, used);
    if (creditAmount && Math.abs(creditAmount.x - columns.credit) > 80) creditAmount = null;
    if (creditAmount) used.add(creditAmount);
    let balanceAmount = closestAmount(amounts, columns.balance, used);
    if (balanceAmount && Math.abs(balanceAmount.x - columns.balance) > 95) balanceAmount = null;

    let direction = null;
    let transactionAmount = null;
    const explicit = amounts.find((amount) => amount.explicitDebit || amount.explicitCredit);
    if (explicit) {
      direction = explicit.explicitDebit ? 'DEBIT' : 'CREDIT';
      transactionAmount = explicit;
    } else if (debitAmount && debitAmount.value > 0 && (!creditAmount || creditAmount.value === 0)) {
      direction = 'DEBIT'; transactionAmount = debitAmount;
    } else if (creditAmount && creditAmount.value > 0 && (!debitAmount || debitAmount.value === 0)) {
      direction = 'CREDIT'; transactionAmount = creditAmount;
    }

    if (!balanceAmount && amounts.length >= 2) balanceAmount = amounts[amounts.length - 1];
    if (!transactionAmount) {
      const nonBalance = amounts.filter((amount) => amount !== balanceAmount && amount.value > 0);
      if (nonBalance.length === 1) transactionAmount = nonBalance[0];
      else if (nonBalance.length > 1) transactionAmount = nonBalance[nonBalance.length - 1];
      else if (amounts.length === 1) transactionAmount = amounts[0];
    }
    if (!transactionAmount || transactionAmount.value <= 0) return null;

    return {
      marker: false,
      line,
      transaction_date: normaliseDate(dateMatch[0], fallbackYear),
      description: description || 'Bank statement transaction',
      amount: transactionAmount.value,
      direction,
      balance: balanceAmount && balanceAmount !== transactionAmount ? balanceAmount.value : null,
      debit: 0,
      credit: 0
    };
  }

  function inferDirections(candidates) {
    const usable = candidates.filter((row) => !row.marker);
    for (let i = 0; i < usable.length; i += 1) {
      const row = usable[i];
      if (row.direction || !Number.isFinite(row.balance)) continue;
      const options = [];
      if (i > 0 && Number.isFinite(usable[i - 1].balance)) {
        const delta = row.balance - usable[i - 1].balance;
        if (near(Math.abs(delta), row.amount)) options.push(delta > 0 ? 'CREDIT' : 'DEBIT');
      }
      if (i + 1 < usable.length && Number.isFinite(usable[i + 1].balance)) {
        const delta = row.balance - usable[i + 1].balance;
        if (near(Math.abs(delta), row.amount)) options.push(delta > 0 ? 'CREDIT' : 'DEBIT');
      }
      if (options.length && options.every((value) => value === options[0])) row.direction = options[0];
      else if (options.length === 1) row.direction = options[0];
    }
    return usable;
  }

  function parsePdfRows(lines) {
    const yearMatches = lines.flatMap((line) => [...line.text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])));
    const fallbackYear = yearMatches.length ? yearMatches.sort((a, b) => b - a)[0] : new Date().getFullYear();
    const columns = detectColumns(lines);
    const candidates = inferDirections(lines.map((line) => candidateFromLine(line, columns, fallbackYear)).filter(Boolean));
    const rows = candidates.filter((row) => row.direction).map((row) => ({
      transaction_date: row.transaction_date,
      description: row.description,
      reference: null,
      debit: row.direction === 'DEBIT' ? row.amount : 0,
      credit: row.direction === 'CREDIT' ? row.amount : 0,
      running_balance: Number.isFinite(row.balance) ? row.balance : null,
      merchant_name: null,
      category: null,
      currency: null
    }));
    const unresolved = candidates.length - rows.length;
    if (!rows.length) {
      throw new Error(`The PDF text was read, but transaction direction could not be verified safely (${candidates.length} transaction candidate${candidates.length === 1 ? '' : 's'} found). Try the bank's detailed statement PDF or CSV/OFX/QFX. No data was imported.`);
    }
    return { rows, diagnostics: { lines: lines.length, candidates: candidates.length, parsed: rows.length, unresolved, columns } };
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

  function notice(message, tone = 'info') {
    const node = $('notice');
    if (!node) return;
    node.hidden = !message;
    node.className = `notice ${tone}`;
    node.textContent = message || '';
  }

  function formatMoney(value, currency = 'AUD') {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(Number(value || 0));
  }

  async function setRowSelection(uid, checkbox) {
    checkbox.disabled = true;
    try {
      await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}/rows/${checkbox.dataset.rowId}/select`, {
        method: 'POST', body: JSON.stringify({ selected: checkbox.checked })
      });
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      notice(error.message, 'error');
    } finally { checkbox.disabled = false; }
  }

  async function openReview(uid) {
    const result = await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}`);
    const session = result.session;
    activeReviewUid = session.import_uid;
    const subtitle = $('reviewSubtitle');
    if (subtitle) subtitle.textContent = `${session.original_name} · ${session.account_name} · ${session.source_format} · ${session.status}`;
    const summary = $('reviewSummary');
    if (summary) summary.innerHTML = `
      <span><b>${Number(session.total_rows || 0)}</b> total</span>
      <span><b>${Number(session.valid_rows || 0)}</b> valid</span>
      <span><b>${Number(session.warning_rows || 0)}</b> warnings</span>
      <span><b>${Number(session.duplicate_rows || 0)}</b> duplicates</span>
      <span><b>${Number(session.rejected_rows || 0)}</b> rejected</span>`;
    const host = $('reviewRows');
    if (host) {
      host.innerHTML = (result.rows || []).map((row) => `
        <tr>
          <td><input type="checkbox" class="row-select" data-row-id="${row.id}" ${Number(row.selected) ? 'checked' : ''} ${row.validation_status === 'REJECTED' || row.validation_status === 'DUPLICATE' ? 'disabled' : ''}></td>
          <td>${escapeHtml(String(row.transaction_date || '').slice(0, 10))}</td>
          <td><strong>${escapeHtml(row.description || row.merchant_name || 'No description')}</strong>${row.validation_message ? `<small>${escapeHtml(row.validation_message)}</small>` : ''}</td>
          <td>${Number(row.debit || 0) ? formatMoney(row.debit, row.currency || session.account_currency || 'AUD') : '—'}</td>
          <td>${Number(row.credit || 0) ? formatMoney(row.credit, row.currency || session.account_currency || 'AUD') : '—'}</td>
          <td>${row.running_balance === null ? '—' : formatMoney(row.running_balance, row.currency || session.account_currency || 'AUD')}</td>
          <td><span class="review-status ${String(row.validation_status || '').toLowerCase()}">${escapeHtml(row.validation_status)}</span></td>
        </tr>`).join('');
      host.querySelectorAll('.row-select').forEach((checkbox) => checkbox.addEventListener('change', () => setRowSelection(activeReviewUid, checkbox)));
    }
    const pending = session.status === 'PENDING_REVIEW';
    if ($('commitReview')) $('commitReview').disabled = !pending;
    if ($('rejectReview')) $('rejectReview').disabled = !pending;
    $('reviewDialog')?.showModal();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('voxelveda:statement-review-rendered')), 0);
  }

  async function preview(accountId, file, rows) {
    const body = { source_format: 'PDF', original_name: file.name, content_hash: await sha256(file), rows };
    let result = await api(`/api/finance/intelligence/accounts/${accountId}/statements/preview`, { method: 'POST', body: JSON.stringify(body) });
    const importable = Number(result.summary?.valid || 0) + Number(result.summary?.warning || 0);
    if (result.reused && importable === 0 && rows.length > 0) {
      await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(result.import_uid)}/reject`, {
        method: 'POST', body: JSON.stringify({ reason: `Automatically superseded by improved PDF parser ${VERSION}; previous pending review contained no importable transaction rows.` })
      });
      result = await api(`/api/finance/intelligence/accounts/${accountId}/statements/preview`, { method: 'POST', body: JSON.stringify(body) });
    }
    return result;
  }

  async function interceptPdfImport(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'importForm') return;
    const file = $('importFile')?.files?.[0];
    if (!file || !/\.pdf$/i.test(file.name)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (installing) return;
    installing = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Reading PDF transactions…'; }
    const stopLoader = window.VoxelVedaBrandLoader?.begin?.({ delay: 120, context: 'Reading bank statement…' });
    try {
      notice('Reading PDF transaction columns, debit/credit direction and running balances…', 'info');
      const lines = await extractPdf(file);
      const parsed = parsePdfRows(lines);
      const accountId = Number($('importAccount')?.value || 0);
      if (!accountId) throw new Error('Choose the bank account before importing the statement.');
      const result = await preview(accountId, file, parsed.rows);
      $('importDialog')?.close();
      form.reset();
      const detail = parsed.diagnostics.unresolved ? ` ${parsed.diagnostics.unresolved} uncertain row(s) were left out instead of being guessed.` : '';
      notice(`${result.message} ${result.summary.valid} valid, ${result.summary.warning} warnings, ${result.summary.duplicate} duplicates, ${result.summary.rejected} rejected.${detail}`, result.summary.warning || result.summary.rejected || parsed.diagnostics.unresolved ? 'warning' : 'success');
      await openReview(result.import_uid);
    } catch (error) {
      notice(error.message || 'PDF statement could not be analysed.', 'error');
    } finally {
      installing = false;
      if (submit) { submit.disabled = false; submit.textContent = 'Preview statement'; }
      if (typeof stopLoader === 'function') stopLoader();
    }
  }

  async function interceptReviewAction(event) {
    const button = event.target?.closest?.('#commitReview, #rejectReview');
    if (!button || !activeReviewUid) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const uid = activeReviewUid;
    try {
      if (button.id === 'commitReview') {
        button.disabled = true;
        const result = await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}/commit`, { method: 'POST', body: '{}' });
        $('reviewDialog')?.close();
        activeReviewUid = null;
        notice(result.message, 'success');
        $('refreshDashboard')?.click();
      } else {
        const reason = window.prompt('Reason for rejecting this statement review:');
        if (!reason) return;
        const result = await api(`/api/finance/intelligence/statement-reviews/${encodeURIComponent(uid)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
        $('reviewDialog')?.close();
        activeReviewUid = null;
        notice(result.message, 'success');
      }
    } catch (error) {
      notice(error.message, 'error');
      button.disabled = false;
    }
  }

  function install() {
    if (window.__vvPdfStatementEnhancerInstalled) return;
    window.__vvPdfStatementEnhancerInstalled = true;
    document.addEventListener('submit', interceptPdfImport, true);
    document.addEventListener('click', interceptReviewAction, true);
    $('reviewDialog')?.addEventListener('close', () => { activeReviewUid = null; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.VoxelVedaPdfStatementParser = Object.freeze({ version: VERSION, parsePdfRows, detectColumns });
})();
