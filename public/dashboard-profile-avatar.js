(function () {
  function initials(name) {
    return String(name || 'VV')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'VV';
  }

  function ensureStyles() {
    if (document.getElementById('vvProfileAvatarStyles')) return;
    const style = document.createElement('style');
    style.id = 'vvProfileAvatarStyles';
    style.textContent = `
      .profile-chip{cursor:pointer}
      #profileInitial.profile-initial{position:relative;overflow:hidden;display:grid;place-items:center;padding:0}
      #profileInitial.profile-initial .vv-dashboard-avatar-img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}
      #profileInitial.profile-initial.vv-has-photo{font-size:0;color:transparent;background:#122231}
      #profileInitial.profile-initial.vv-has-photo::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);pointer-events:none}
    `;
    document.head.appendChild(style);
  }

  function findChip() {
    return document.querySelector('.profile-chip');
  }

  function findInitialTarget(chip) {
    return chip?.querySelector('#profileInitial, .profile-initial') || null;
  }

  function renderFallback(target, profile) {
    target.classList.remove('vv-has-photo');
    target.replaceChildren(document.createTextNode(initials(profile?.name)));
  }

  function renderChip(profile) {
    const chip = findChip();
    const target = findInitialTarget(chip);
    if (!chip || !target || !profile) return;

    ensureStyles();
    chip.onclick = (event) => {
      event.preventDefault();
      window.location.assign('/profile');
    };
    chip.setAttribute('aria-label', `Open profile for ${profile.name || 'current user'}`);
    chip.title = 'My Profile';

    const nameLabel = chip.querySelector('#profileNameLabel');
    if (nameLabel && profile.name) nameLabel.textContent = profile.name;

    if (!profile.has_profile_photo || !profile.profile_photo_url) {
      renderFallback(target, profile);
      return;
    }

    target.classList.add('vv-has-photo');
    target.replaceChildren();
    const image = document.createElement('img');
    image.className = 'vv-dashboard-avatar-img';
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.src = `${profile.profile_photo_url}${profile.profile_photo_url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    image.onerror = () => renderFallback(target, profile);
    target.appendChild(image);
  }

  async function refreshProfileAvatar() {
    const chip = findChip();
    if (!chip) return;
    try {
      const response = await fetch('/api/profile', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.json();
      renderChip(data.profile);
    } catch {}
  }

  function scheduleRefreshes() {
    refreshProfileAvatar();
    [300, 900, 1800, 3200].forEach((delay) => setTimeout(refreshProfileAvatar, delay));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleRefreshes, { once: true });
  else scheduleRefreshes();

  window.addEventListener('pageshow', refreshProfileAvatar);
  window.addEventListener('focus', refreshProfileAvatar);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshProfileAvatar();
  });
  window.addEventListener('vv:profile-photo-updated', refreshProfileAvatar);
})();
