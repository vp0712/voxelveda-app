(function () {
  'use strict';
  function bindProfileChips() {
    for(const chip of document.querySelectorAll('.profile-chip')){
      chip.onclick=event=>{event.preventDefault();window.location.assign('/profile');};
      chip.title='My Profile';chip.setAttribute('aria-label','Open my profile');
    }
    window.VoxelAvatar?.mountAll();window.VoxelAvatar?.refreshSelf();
  }
  window.addEventListener('vv:avatar-profile',event=>{
    for(const chip of document.querySelectorAll('.profile-chip')){
      const name=event.detail.profile.name || 'My Profile';
      const label=chip.querySelector('#profileNameLabel');if(label)label.textContent=name;
      chip.setAttribute('aria-label',`Open profile for ${name}`);
    }
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindProfileChips,{once:true});else bindProfileChips();
})();
