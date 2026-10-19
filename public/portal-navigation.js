(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded',()=>{
    const nav=document.querySelector('.sidebar nav');
    if(!nav||nav.querySelector('input[type="search"]')||document.getElementById('workspaceNavSearch'))return;
    const label=document.createElement('label');label.className='portal-nav-search';label.textContent='Find a page';
    const input=document.createElement('input');input.type='search';input.maxLength=80;input.autocomplete='off';input.setAttribute('aria-label','Find a permitted page');label.append(input);nav.prepend(label);
    const note=document.createElement('p');note.className='portal-nav-search-note';note.setAttribute('role','status');note.hidden=true;label.after(note);
    function filter(){const query=input.value.trim().toLowerCase();let visible=0;nav.querySelectorAll('button[data-section]').forEach(button=>{const match=!query||button.textContent.toLowerCase().includes(query);button.classList.toggle('portal-nav-search-hidden',!match);if(match&&getComputedStyle(button).display!=='none')visible++;});note.hidden=!query;note.textContent=visible?`${visible} available pages match`:'No permitted pages match. Clear the search to see navigation.';}
    input.addEventListener('input',filter);input.addEventListener('keydown',event=>{if(event.key==='Escape'){input.value='';filter();}});
  });
})();
