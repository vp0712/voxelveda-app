(() => {
  'use strict';
  if (location.pathname !== '/finance-intelligence' || window.__vvAdvancedBankingInstalled) return;
  window.__vvAdvancedBankingInstalled = true;

  const API = '/api/integrations/webhooks/banking';
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v, currency='AUD') => new Intl.NumberFormat('en-AU',{style:'currency',currency}).format(Number(v||0));
  const when = (v) => v ? new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : 'Never';

  async function api(path, options={}) {
    const response = await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    let body={}; try{body=await response.json();}catch{}
    if(!response.ok){const e=new Error(body.message||`Request failed (${response.status})`);e.code=body.code;e.status=response.status;throw e;}
    return body;
  }

  function installAssets(){
    if(!$('advancedBankingCss')){const link=document.createElement('link');link.id='advancedBankingCss';link.rel='stylesheet';link.href='/advanced-banking-ui.css?v=20260918-au-banking';document.head.appendChild(link);}
    if(!$('financePdfV3')){const script=document.createElement('script');script.id='financePdfV3';script.src='/finance-pdf-v3.js?v=20260918-pdf-v3';script.defer=true;document.head.appendChild(script);}
  }

  function installHub(){
    if($('advancedBankingHub')) return;
    const anchor=document.querySelector('.actions.primary-actions');
    if(!anchor) return;
    const section=document.createElement('section');
    section.id='advancedBankingHub';
    section.className='vv-bank-hub';
    section.innerHTML=`
      <div class="vv-bank-hero">
        <div><p class="eyebrow">AUSTRALIAN BANKING HUB</p><h2>Bank-connected money</h2><p id="vvBankHeadline">Checking secure bank connectivity…</p></div>
        <span id="vvBankStatus" class="vv-bank-status">Checking</span>
      </div>
      <div class="vv-bank-actions">
        <button id="vvConnectBank" class="vv-bank-primary" type="button">Connect Bank</button>
        <button id="vvSyncBanks" type="button">Sync now</button>
        <button id="vvUploadStatement" type="button">Upload statement</button>
        <button id="vvConsentCenter" type="button">Consent & privacy</button>
      </div>
      <nav class="vv-bank-tabs" aria-label="Banking views">
        <button class="active" data-bank-tab="overview">Overview</button><button data-bank-tab="accounts">Accounts</button><button data-bank-tab="transactions">Transactions</button><button data-bank-tab="insights">Insights</button><button data-bank-tab="more">More</button>
      </nav>
      <div id="vvBankContent" class="vv-bank-content"><div class="vv-bank-empty">Loading banking overview…</div></div>`;
    anchor.insertAdjacentElement('afterend',section);
    section.addEventListener('click',handleClick);
  }

  let state={status:null,connections:[],quality:null,tab:'overview',busy:false};

  function healthClass(status){if(!status?.configured)return 'setup';if(status.environment==='PRODUCTION'&&!status.live_sync_enabled)return 'setup';if(Number(status.connection_summary?.attention||0)>0)return 'attention';return 'healthy';}

  function renderOverview(){
    const s=state.status||{}; const q=state.quality||{}; const con=s.connection_summary||{};
    $('vvBankContent').innerHTML=`<div class="vv-bank-metrics">
      <article><span>Connected banks</span><strong>${Number(con.active||0)}</strong><small>${Number(con.attention||0)} need attention</small></article>
      <article><span>Data quality</span><strong>${Number(q.score||0).toFixed(1)}%</strong><small>${escapeHtml(q.guidance||'Waiting for data')}</small></article>
      <article><span>Last sync</span><strong>${con.last_sync?when(con.last_sync):'Not synced'}</strong><small>${escapeHtml(s.provider_name||s.provider||'Provider')}</small></article>
    </div><div class="vv-bank-callout"><strong>Direct connection is the primary source.</strong><span>Statement upload remains available as a fallback. Voxel Veda never asks for your bank password, PIN or OTP.</span></div>`;
  }

  function renderAccounts(){
    const accounts=state.connections.flatMap(c=>(c.accounts||[]).map(a=>({...a,institution:c.institution,connection_uid:c.connection_uid,connection_status:c.status})));
    $('vvBankContent').innerHTML=accounts.length?`<div class="vv-bank-account-grid">${accounts.map(a=>`<article class="vv-bank-account"><div><small>${escapeHtml(a.institution||'Connected bank')} · ${escapeHtml(a.account_type||'Account')}</small><h3>${escapeHtml(a.account_name||'Account')}</h3><span>${escapeHtml(a.account_number_masked||'number masked')}</span></div><strong>${money(a.available_balance??a.current_balance,a.currency||'AUD')}</strong><div class="vv-bank-account-meta"><span>${escapeHtml(a.ownership_scope||'UNCLASSIFIED')}</span><span>${escapeHtml(a.status||'ACTIVE')}</span></div>${a.bank_account_id?`<button type="button" data-bank-transactions="${Number(a.bank_account_id)}">View transactions</button>`:''}</article>`).join('')}</div>`:`<div class="vv-bank-empty"><strong>No linked bank accounts yet</strong><span>Use Connect Bank to start the provider consent flow, then Sync now after consent completes.</span></div>`;
  }

  async function renderTransactions(accountId){
    if(!accountId){
      const first=state.connections.flatMap(c=>c.accounts||[]).find(a=>a.bank_account_id)?.bank_account_id;
      if(!first){$('vvBankContent').innerHTML='<div class="vv-bank-empty">Connect or import an account to see transactions.</div>';return;}
      accountId=first;
    }
    $('vvBankContent').innerHTML='<div class="vv-bank-empty">Loading transactions…</div>';
    try{const data=await api(`${API}/accounts/${accountId}/transactions?limit=80`);const rows=data.transactions||[];$('vvBankContent').innerHTML=rows.length?`<div class="vv-bank-transactions">${rows.map(t=>{const out=Number(t.debit||0)>0;const amount=out?-Number(t.debit):Number(t.credit||0);return `<article><div><strong>${escapeHtml(t.merchant_name||t.description||'Transaction')}</strong><small>${escapeHtml(String(t.transaction_date||'').slice(0,10))} · ${escapeHtml(t.category||'Uncategorised')} · ${escapeHtml(t.source_type||'')}</small></div><b class="${out?'out':'in'}">${money(amount,t.currency||data.account?.currency||'AUD')}</b></article>`}).join('')}</div>`:'<div class="vv-bank-empty">No transactions in this account yet.</div>';}
    catch(e){$('vvBankContent').innerHTML=`<div class="vv-bank-empty">${escapeHtml(e.message)}</div>`;}
  }

  function renderInsights(){const q=state.quality||{};const t=q.transactions||{};const c=q.connections||{};$('vvBankContent').innerHTML=`<div class="vv-bank-quality"><h3>Bank data quality</h3><div><span>Unclassified transactions</span><b>${Number(t.unclassified||0)}</b></div><div><span>Unreconciled transactions</span><b>${Number(t.unreconciled||0)}</b></div><div><span>Missing canonical fingerprint</span><b>${Number(t.missing_fingerprint||0)}</b></div><div><span>Connections needing attention</span><b>${Number(c.attention||0)}</b></div></div>`;}

  function renderMore(){
    $('vvBankContent').innerHTML=`<div class="vv-bank-more"><article><h3>Consent & data controls</h3><p>Review consent status, connection lifecycle and privacy boundaries. Disconnecting stops future sync while preserving existing financial history unless it is separately deleted under the data policy.</p><button type="button" data-bank-action="consents">Open consent center</button></article><article><h3>Import fallback</h3><p>Use CSV, OFX or QFX where possible. PDF parsing uses geometry, confidence and reconciliation checks and never silently treats an uncertain row as a transaction.</p><button type="button" data-bank-action="upload">Upload statement</button></article></div>`;
  }

  function render(){
    const s=state.status||{};const klass=healthClass(s);$('vvBankStatus').className=`vv-bank-status ${klass}`;$('vvBankStatus').textContent=!s.configured?'Provider setup required':klass==='healthy'?'Connected & protected':klass==='attention'?'Needs attention':'Sandbox / locked';
    $('vvBankHeadline').textContent=!s.configured?`${s.provider_name||'Basiq'} adapter is installed, but provider credentials are not configured in production.`:s.environment==='PRODUCTION'&&!s.live_sync_enabled?'Provider is configured but production live sync remains locked until explicitly enabled.':`Secure ${s.provider_name||s.provider} connectivity is ready. ${Number(s.connection_summary?.active||0)} active connection(s).`;
    document.querySelectorAll('[data-bank-tab]').forEach(b=>b.classList.toggle('active',b.dataset.bankTab===state.tab));
    if(state.tab==='overview')renderOverview();else if(state.tab==='accounts')renderAccounts();else if(state.tab==='transactions')renderTransactions();else if(state.tab==='insights')renderInsights();else renderMore();
  }

  async function refresh(){
    try{const [status,connections,quality]=await Promise.all([api(`${API}/status`),api(`${API}/connections`),api(`${API}/data-quality`)]);state.status=status;state.connections=connections.connections||[];state.quality=quality;render();}
    catch(e){$('vvBankHeadline').textContent=e.message;$('vvBankStatus').textContent='Unavailable';$('vvBankStatus').className='vv-bank-status attention';}
  }

  async function connectBank(){
    try{const providers=await api('/api/finance/intelligence/open-banking/providers');const chosen=providers.selected_provider||'BASIQ';const result=await api('/api/finance/intelligence/open-banking/consent',{method:'POST',body:JSON.stringify({provider:chosen})});if(result.consent_url){window.location.assign(result.consent_url);return;}}
    catch(e){window.alert(e.message);}
  }
  async function syncNow(){if(state.busy)return;state.busy=true;const button=$('vvSyncBanks');button.disabled=true;button.textContent='Syncing…';try{const result=await api(`${API}/sync`,{method:'POST',body:JSON.stringify({trigger:'MANUAL'})});window.alert(result.message);await refresh();}catch(e){window.alert(e.message);}finally{state.busy=false;button.disabled=false;button.textContent='Sync now';}}
  async function showConsents(){try{const data=await api(`${API}/consents`);const provider=(data.provider_consents||[]);const local=data.local_receipts||[];$('vvBankContent').innerHTML=`<div class="vv-bank-consent"><h3>Consent & privacy center</h3><p>${escapeHtml(data.privacy?.bank_credentials_stored===false?'Voxel Veda does not store your bank password, PIN or OTP.':'')}</p><h4>Provider consent</h4>${provider.length?provider.map(c=>`<div class="vv-bank-line"><span>${escapeHtml(c.status||c.type||'Consent')}</span><b>${escapeHtml(c.id||c.consentId||'')}</b></div>`).join(''):'<p>No provider consent is currently visible.</p>'}<h4>Local consent history</h4>${local.length?local.map(c=>`<div class="vv-bank-line"><span>${escapeHtml(c.provider)} · ${escapeHtml(c.consent_status)}</span><b>${when(c.created_at)}</b></div>`).join(''):'<p>No local consent receipts yet.</p>'}<p class="vv-bank-legal">CDR status shown here describes the provider/data-sharing flow only; Voxel Veda does not claim independent CDR accreditation.</p></div>`;}catch(e){window.alert(e.message);}}

  function handleClick(event){
    const tab=event.target.closest('[data-bank-tab]');if(tab){state.tab=tab.dataset.bankTab;render();return;}
    const tx=event.target.closest('[data-bank-transactions]');if(tx){state.tab='transactions';document.querySelectorAll('[data-bank-tab]').forEach(b=>b.classList.toggle('active',b.dataset.bankTab==='transactions'));renderTransactions(Number(tx.dataset.bankTransactions));return;}
    if(event.target.closest('#vvConnectBank'))return connectBank();if(event.target.closest('#vvSyncBanks'))return syncNow();if(event.target.closest('#vvUploadStatement')||event.target.closest('[data-bank-action="upload"]'))return $('importStatement')?.click();if(event.target.closest('#vvConsentCenter')||event.target.closest('[data-bank-action="consents"]'))return showConsents();
  }

  function init(){installAssets();installHub();refresh();window.addEventListener('voxelveda:network-restored',()=>refresh());}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
