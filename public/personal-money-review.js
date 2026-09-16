(() => {
  const API = '/api/finance/personal-money/review-inbox';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money = (v, code='AUD') => { try { return new Intl.NumberFormat('en-AU',{style:'currency',currency:code}).format(Number(v||0)); } catch { return `${Number(v||0).toFixed(2)} ${code}`; } };
  const date = (v) => v ? new Intl.DateTimeFormat('en-AU',{dateStyle:'medium'}).format(new Date(`${String(v).slice(0,10)}T00:00:00`)) : 'No date';
  let data = null;

  async function api(path='', options={}) {
    const r = await fetch(`${API}${path}`, { credentials:'same-origin', headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options });
    let p={}; try { p=await r.json(); } catch {}
    if(!r.ok) throw new Error(p.message || `Request failed (${r.status})`);
    return p;
  }

  function installStyles() {
    if (document.querySelector('style[data-pmr]')) return;
    const s=document.createElement('style'); s.dataset.pmr='1'; s.textContent=`
      .pmr-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px;border:1px solid rgba(34,197,94,.22);border-radius:18px;background:linear-gradient(135deg,rgba(34,197,94,.07),rgba(56,189,248,.04))}.pmr-hero h2{margin:4px 0 7px}.pmr-badge{padding:6px 10px;border-radius:999px;background:rgba(34,197,94,.12);color:#86efac;font-size:.78rem;font-weight:700}.pmr-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.pmr-summary article,.pmr-card{padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:15px;background:rgba(255,255,255,.025)}.pmr-summary span,.pmr-card small{color:var(--muted,#9ca7b4)}.pmr-summary strong{display:block;font-size:1.3rem;margin-top:5px}.pmr-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.pmr-match{padding:13px;border:1px solid rgba(34,197,94,.2);border-radius:14px;margin:9px 0;background:rgba(34,197,94,.025)}.pmr-match.price{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.035)}.pmr-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.pmr-right{text-align:right}.pmr-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.pmr-actions button{min-height:38px}.pmr-confidence{display:inline-block;padding:4px 8px;border-radius:999px;background:rgba(56,189,248,.11);font-size:.72rem;font-weight:700}.pmr-change{display:inline-block;padding:4px 8px;border-radius:999px;background:rgba(245,158,11,.12);color:#fcd34d;font-size:.72rem;font-weight:700;margin-left:5px}.pmr-empty{padding:16px;text-align:center;border:1px dashed rgba(255,255,255,.12);border-radius:13px;color:var(--muted,#9ca7b4)}.pmr-due,.pmr-dup{padding:11px 0;border-top:1px solid rgba(255,255,255,.06)}.pmr-due:first-child,.pmr-dup:first-child{border-top:0}.pmr-note{padding:11px 12px;border-left:3px solid #38bdf8;background:rgba(56,189,248,.05);border-radius:9px;color:var(--muted,#aeb8c4);margin:12px 0}.pmr-refresh{margin-top:10px}
      @media(max-width:850px){.pmr-summary{grid-template-columns:1fr 1fr}.pmr-grid{grid-template-columns:1fr}}
      @media(max-width:560px){.pmr-hero,.pmr-row{flex-direction:column}.pmr-right{text-align:left}.pmr-summary{grid-template-columns:1fr 1fr}.pmr-actions button{flex:1 1 100%;min-height:44px}.pmr-refresh{width:100%;min-height:44px}}
    `; document.head.appendChild(s);
  }

  function install() {
    if ($('personalMoneyReviewPanel')) return;
    installStyles();
    const button=document.createElement('button'); button.id='openMoneyReviewInbox'; button.type='button'; button.textContent='Review Inbox';
    const smart=$('openSmartMoney');
    if (smart?.parentElement) smart.insertAdjacentElement('afterend',button);
    else document.querySelector('.primary-actions')?.prepend(button);

    const panel=document.createElement('section'); panel.id='personalMoneyReviewPanel'; panel.className='panel';
    panel.innerHTML=`
      <div class="pmr-hero"><div><p class="eyebrow">SMART REVIEW INBOX</p><h2>Has this bill already been paid?</h2><p class="muted">The app compares your personal bank transactions with your reminders and shows likely matches. Nothing changes until you confirm it.</p></div><span class="pmr-badge">Confirm first</span></div>
      <button id="pmrRefresh" type="button" class="pmr-refresh">Refresh matches</button>
      <div id="pmrMessage" class="notice" hidden></div>
      <div id="pmrContent"><p class="muted">Open Review Inbox to check likely payments.</p></div>`;
    const smartPanel=$('personalMoneySmartPanel');
    if (smartPanel?.parentElement) smartPanel.insertAdjacentElement('afterend',panel);
    else document.querySelector('.fi-shell')?.appendChild(panel);
    bind();
  }

  function msg(text,tone='info') { const el=$('pmrMessage'); if(!el)return; el.hidden=!text; el.className=`notice ${tone}`; el.textContent=text||''; }

  async function load() {
    const b=$('pmrRefresh'); if(b){b.disabled=true;b.textContent='Checking…';}
    try { data=await api(); render(); msg(''); }
    catch(err){ msg(err.message,'error'); }
    finally { if(b){b.disabled=false;b.textContent='Refresh matches';} }
  }

  async function confirm(recurringId, transactionId, updateAmount) {
    const warning = updateAmount ? 'Confirm this bank transaction and use its amount for future reminders?' : 'Confirm this bank transaction as the matching payment/receipt?';
    if (!window.confirm(warning)) return;
    try {
      const r=await api(`/${encodeURIComponent(recurringId)}/${encodeURIComponent(transactionId)}/confirm`,{method:'POST',body:JSON.stringify({update_amount:Boolean(updateAmount)})});
      msg(r.message,'success'); await load();
    } catch(err){ msg(err.message,'error'); }
  }

  async function dismiss(recurringId, transactionId) {
    try {
      const r=await api(`/${encodeURIComponent(recurringId)}/${encodeURIComponent(transactionId)}/dismiss`,{method:'POST',body:'{}'});
      msg(r.message,'success'); await load();
    } catch(err){ msg(err.message,'error'); }
  }

  function renderMatch(m) {
    return `<article class="pmr-match ${m.price_changed?'price':''}">
      <div class="pmr-row"><div><strong>${esc(m.recurring_name)}</strong><br><small>${esc(m.merchant)} · ${esc(m.account_name||'Personal account')}</small><div style="margin-top:7px"><span class="pmr-confidence">${Number(m.confidence||0)}% match</span>${m.price_changed?`<span class="pmr-change">Price ${Number(m.price_change_percent)>0?'+':''}${Number(m.price_change_percent||0).toFixed(1)}%</span>`:''}</div></div><div class="pmr-right"><strong>${money(m.actual_amount,m.currency)}</strong><small>Bank: ${date(m.transaction_date)}<br>Expected: ${money(m.expected_amount,m.currency)} · ${date(m.expected_due_date)}</small></div></div>
      <p class="muted">${esc(m.explanation)}</p>
      <div class="pmr-actions"><button type="button" class="primary" data-pmr-confirm="${esc(m.recurring_item_id)}" data-pmr-tx="${esc(m.bank_transaction_id)}">Confirm match</button>${m.price_changed?`<button type="button" data-pmr-update="${esc(m.recurring_item_id)}" data-pmr-tx="${esc(m.bank_transaction_id)}">Confirm + use ${money(m.actual_amount,m.currency)} next time</button>`:''}<button type="button" data-pmr-dismiss="${esc(m.recurring_item_id)}" data-pmr-tx="${esc(m.bank_transaction_id)}">Not this payment</button></div>
    </article>`;
  }

  function render() {
    const s=data?.summary||{}; const matches=data?.matches||[]; const due=data?.still_due||[]; const dup=data?.duplicate_candidates||[];
    $('pmrContent').innerHTML=`
      <div class="pmr-summary"><article><span>Likely paid / received</span><strong>${s.likely_paid||0}</strong><small>Waiting for your confirmation</small></article><article><span>Still due</span><strong>${s.still_due||0}</strong><small>No strong bank match yet</small></article><article><span>Price changed</span><strong>${s.price_changes||0}</strong><small>You choose whether future amount changes</small></article><article><span>Duplicate-looking</span><strong>${s.duplicate_looking||0}</strong><small>Review only · nothing deleted</small></article></div>
      <p class="pmr-note">${esc(data?.explanation||'Review suggestions only.')}</p>
      <div class="pmr-grid"><article class="pmr-card"><h3>Likely paid — confirm these</h3>${matches.length?matches.map(renderMatch).join(''):'<div class="pmr-empty">No high-confidence payment matches right now.</div>'}</article>
      <div><article class="pmr-card"><h3>Still due / no match</h3>${due.length?due.map(d=>`<div class="pmr-due"><div class="pmr-row"><div><strong>${esc(d.name)}</strong><small>${esc(d.item_type)} · ${esc(d.frequency)}</small></div><div class="pmr-right"><strong>${money(d.amount,d.currency)}</strong><small>${date(d.due_date)}</small></div></div><small>${esc(d.explanation)}</small></div>`).join(''):'<div class="pmr-empty">Nothing overdue without a match.</div>'}</article>
      <article class="pmr-card" style="margin-top:12px"><h3>Duplicate-looking transactions</h3><p class="muted">These are only warnings. The app will never delete a bank transaction automatically.</p>${dup.length?dup.map(d=>`<div class="pmr-dup"><div class="pmr-row"><div><strong>${esc(d.merchant)}</strong><small>${esc(d.account_name||'Personal account')} · transaction IDs ${d.transaction_ids.map(esc).join(' / ')}</small></div><div class="pmr-right"><strong>${money(d.amount,d.currency)}</strong><small>${date(d.transaction_date)}${d.other_date&&d.other_date!==d.transaction_date?` / ${date(d.other_date)}`:''}</small></div></div><small>${esc(d.explanation)}</small></div>`).join(''):'<div class="pmr-empty">No duplicate-looking personal transactions found.</div>'}</article></div></div>`;
  }

  function bind() {
    $('openMoneyReviewInbox')?.addEventListener('click',async()=>{$('personalMoneyReviewPanel')?.scrollIntoView({behavior:'smooth',block:'start'}); if(!data) await load();});
    $('pmrRefresh')?.addEventListener('click',load);
    document.addEventListener('click',(e)=>{
      const confirmBtn=e.target.closest('[data-pmr-confirm]'); if(confirmBtn) return confirm(confirmBtn.dataset.pmrConfirm,confirmBtn.dataset.pmrTx,false);
      const updateBtn=e.target.closest('[data-pmr-update]'); if(updateBtn) return confirm(updateBtn.dataset.pmrUpdate,updateBtn.dataset.pmrTx,true);
      const dismissBtn=e.target.closest('[data-pmr-dismiss]'); if(dismissBtn) return dismiss(dismissBtn.dataset.pmrDismiss,dismissBtn.dataset.pmrTx);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install); else install();
})();
