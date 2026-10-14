(() => {
  'use strict';
  const menu=document.getElementById('portalProfileMenu'),trigger=document.querySelector('[data-profile-menu-toggle]');if(!menu||!trigger)return;
  function close(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
  trigger.addEventListener('click',event=>{event.preventDefault();const open=menu.hidden;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open)menu.querySelector('a,button')?.focus();});
  document.addEventListener('click',event=>{if(!menu.contains(event.target)&&!trigger.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){close();trigger.focus();}});
})();
