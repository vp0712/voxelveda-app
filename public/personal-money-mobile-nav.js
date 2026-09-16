(() => {
  const $=(id)=>document.getElementById(id);
  const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=(v,c='AUD')=>{try{return new Intl.NumberFormat('en-AU',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v||0));}catch{return `${Number(v||0).toFixed(2)} ${c}`;}};
  const fmtDay=(v)=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short'}).format(new Date(`${String(v).slice(0,10)}T00:00:00`));
  const endpoints={smart:'/api/finance/personal-money/smart',attention:'/api/finance/personal-money/attention',roadmaps:'/api/finance/personal-money/roadmaps'};
  let snapshot=null,installAttempts=0;

  async function get(url){const r=await fetch(url,{credentials:'same-origin'});let p={};try{p=await r.json();}catch{}if(!r.ok)throw new Error(p.message||`Request failed (${r.status})`);return p;}
  async function load(){const results=await Promise.allSettled(Object.entries(endpoints).map(async([key,url])=>[key,await get(url)]));snapshot={};results.forEach(r=>{if(r.status==='fulfilled')snapshot[r.value[0]]=r.value[1];});renderPriority();renderWeek();updateBadges();}

  function style(){if(document.querySelector('style[data-pmn]'))return;const s=document.createElement('style');s.dataset.pmn='1';s.textContent=`
    .pmn-priority{margin:14px 0;padding:14px;border-radius:16px;border:1px solid rgba(245,158,11,.25);background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(59,130,246,.04))}
    .pmn-priority.good{border-color:rgba(34,197,94,.24);background:linear-gradient(135deg,rgba(34,197,94,.07),rgba(59,130,246,.03))}
    .pmn-priority h3{margin:3px 0 5px}.pmn-priority p{margin:0;color:var(--muted,#9ca7b4)}
    .pmn-week{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr));gap:8px;overflow-x:auto;padding:2px 0 8px;scroll-snap-type:x proximity}
    .pmn-day{scroll-snap-align:start;min-width:110px;padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.025)}
    .pmn-day.today{border-color:rgba(59,130,246,.35);background:rgba(59,130,246,.06)}.pmn-day strong,.pmn-day small{display:block}.pmn-day small{color:var(--muted,#9ca7b4)}
    .pmn-event{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.06)}.pmn-event.in strong{color:#86efac}.pmn-event.out strong{color:#fca5a5}
    .pmn-advanced{margin-top:16px;border:1px solid rgba(255,255,255,.08);border-radius:15px;background:rgba(255,255,255,.02)}.pmn-advanced summary{cursor:pointer;padding:14px;font-weight:700}.pmn-advanced>div{padding:0 14px 14px}
    .pmn-bottom{display:none}.pmn-nav-badge{display:none;position:absolute;top:3px;right:10px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#ef4444;color:white;font-size:.65rem;line-height:17px;text-align:center}
    @media(max-width:760px){body{padding-bottom:76px}.pmn-bottom{position:fixed;z-index:999;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(5,1fr);gap:4px;padding:7px;border-radius:18px;background:rgba(12,18,28,.96);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(18px);box-shadow:0 12px 35px rgba(0,0,0,.35)}.pmn-bottom button{position:relative;min-height:50px;border:0;background:transparent;font-size:.72rem;padding:6px 2px}.pmn-bottom button span{display:block;font-size:1.05rem;margin-bottom:2px}.pmn-bottom button.active{background:rgba(59,130,246,.12);border-radius:12px}.pmn-week{grid-template-columns:repeat(7,128px)}}
  `;document.head.appendChild(s);}

  function install(){
    if($('personalMoneyMobileNav'))return;
    const home=$('personalMoneyHomePanel');
    if(!home){if(installAttempts++<50)return setTimeout(install,100);return;}
    style();
    const top=document.createElement('div');top.id='pmnPriority';top.className='pmn-priority';top.innerHTML='<p>Checking what matters most…</p>';home.querySelector('.pmh-actions')?.insertAdjacentElement('afterend',top);
    const week=document.createElement('section');week.id='pmnWeekPanel';week.className='pmh-card';week.innerHTML='<p class="eyebrow">THIS WEEK</p><h3>Next 7 days</h3><div id="pmnWeek" class="pmn-week"><p class="muted">Loading timeline…</p></div>';top.insertAdjacentElement('afterend',week);
    collapseAdvanced();
    const nav=document.createElement('nav');nav.id='personalMoneyMobileNav';nav.className='pmn-bottom';nav.setAttribute('aria-label','Personal money navigation');nav.innerHTML=`
      <button type="button" data-pmn-target="personalMoneyHomePanel" class="active"><span>⌂</span>Home</button>
      <button type="button" data-pmn-target="personalMoneyPanel"><span>↕</span>Transactions</button>
      <button type="button" data-pmn-target="roadmapPanel"><span>◎</span>Plans<b id="pmnPlansBadge" class="pmn-nav-badge"></b></button>
      <button type="button" data-pmn-target="personalNetWorthPanel"><span>◇</span>Wealth</button>
      <button type="button" data-pmn-target="pmnAdvancedDetails"><span>•••</span>More<b id="pmnMoreBadge" class="pmn-nav-badge"></b></button>`;document.body.appendChild(nav);
    nav.addEventListener('click',e=>{const b=e.target.closest('[data-pmn-target]');if(!b)return;nav.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));const id=b.dataset.pmnTarget;if(id==='pmnAdvancedDetails'){const d=$(id);if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}return;}$(id)?.scrollIntoView({behavior:'smooth',block:'start'});});
    $('openPersonalMoneyHome')?.addEventListener('click',()=>setTimeout(load,80));
    $('pmhRefresh')?.addEventListener('click',()=>setTimeout(load,120));
    load().catch(()=>{});
  }

  function collapseAdvanced(){const content=$('pmhContent');if(!content)return;const wrap=()=>{if($('pmnAdvancedDetails'))return;const quick=content.querySelector('.pmh-quick');if(!quick)return;const title=quick.previousElementSibling;const details=document.createElement('details');details.id='pmnAdvancedDetails';details.className='pmn-advanced';details.innerHTML='<summary>Advanced tools</summary><div></div>';quick.parentNode.insertBefore(details,title||quick);const holder=details.querySelector('div');if(title)holder.appendChild(title);holder.appendChild(quick);};wrap();const observer=new MutationObserver(wrap);observer.observe(content,{childList:true,subtree:false});}

  function severityScore(a){return ({URGENT:4,HIGH:3,MEDIUM:2,LOW:1})[String(a?.severity||'').toUpperCase()]||0;}
  function renderPriority(){const host=$('pmnPriority');if(!host)return;const alerts=snapshot?.attention?.alerts||[];const activeRoads=(snapshot?.roadmaps?.roadmaps||[]).filter(r=>r.status==='ACTIVE');const behind=activeRoads.filter(r=>r.intelligence?.trajectory==='BEHIND');const urgent=alerts.filter(a=>severityScore(a)>=3).sort((a,b)=>severityScore(b)-severityScore(a));let title='You are clear for now';let text='No high-priority personal money action is currently visible.';let cls='pmn-priority good';if(urgent.length){title=urgent[0].title;text=`Highest priority: ${urgent[0].explanation||'Review this item today.'}`;cls='pmn-priority';}else if(behind.length){title=`${behind[0].name} needs attention`;text=behind[0].intelligence?.action_text||behind[0].intelligence?.what_to_do_this_month||'Review your roadmap progress this month.';cls='pmn-priority';}host.className=cls;host.innerHTML=`<p class="eyebrow">TOP PRIORITY</p><h3>${esc(title)}</h3><p>${esc(text)}</p>`;}

  function next7Dates(){const out=[];const now=new Date();now.setHours(0,0,0,0);for(let i=0;i<7;i++){const d=new Date(now);d.setDate(now.getDate()+i);out.push(d.toISOString().slice(0,10));}return out;}
  function renderWeek(){const host=$('pmnWeek');if(!host)return;const dates=next7Dates();const events=(snapshot?.smart?.cashflow_calendar||[]).filter(e=>dates.includes(String(e.date).slice(0,10)));host.innerHTML=dates.map((date,index)=>{const dayEvents=events.filter(e=>String(e.date).slice(0,10)===date);return `<article class="pmn-day ${index===0?'today':''}"><strong>${index===0?'Today':fmtDay(date)}</strong><small>${index===0?fmtDay(date):dayEvents.length?`${dayEvents.length} item${dayEvents.length===1?'':'s'}`:'No planned items'}</small>${dayEvents.map(e=>`<div class="pmn-event ${e.direction==='IN'?'in':'out'}"><small>${esc(e.title)}</small><strong>${e.direction==='IN'?'+':'−'}${money(e.amount,e.currency)}</strong></div>`).join('')}</article>`;}).join('');}

  function updateBadges(){const alerts=snapshot?.attention?.alerts||[];const urgent=alerts.filter(a=>severityScore(a)>=3).length;const behind=(snapshot?.roadmaps?.roadmaps||[]).filter(r=>r.status==='ACTIVE'&&r.intelligence?.trajectory==='BEHIND').length;const more=$('pmnMoreBadge'),plans=$('pmnPlansBadge');if(more){more.textContent=urgent||'';more.style.display=urgent?'block':'none';}if(plans){plans.textContent=behind||'';plans.style.display=behind?'block':'none';}}

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
