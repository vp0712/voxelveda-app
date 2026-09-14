(function () {
  const PHOTO_URL = '/api/profile/photo';

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
      .profile-chip{position:relative;overflow:hidden}
      .vv-profile-avatar{position:absolute;inset:5px;border-radius:50%;overflow:hidden;background:#2fd3a2;display:grid;place-items:center;color:#04130f;font-weight:900;pointer-events:none}
      .vv-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}
      .vv-profile-avatar span{font-size:1rem;line-height:1}
      .vv-profile-avatar-badge{position:absolute;right:2px;bottom:2px;width:10px;height:10px;border-radius:50%;background:#32d6c6;border:2px solid #0c1722;pointer-events:none}
    `;
    document.head.appendChild(style);
  }

  function findChip() {
    return document.querySelector('.profile-chip');
  }

  function renderChip(profile) {
    const chip = findChip();
    if (!chip || !profile) return;
    ensureStyles();
    chip.onclick = (event) => {
      event.preventDefault();
      window.location.assign('/profile');
    };
    chip.setAttribute('aria-label', `Open profile for ${profile.name || 'current user'}`);
    chip.title = 'My Profile';

    let avatar = chip.querySelector('.vv-profile-avatar');
    if (!avatar) {
      avatar = document.createElement('span');
      avatar.className = 'vv-profile-avatar';
      chip.appendChild(avatar);
    }
    avatar.replaceChildren();

    if (profile.has_profile_photo && profile.profile_photo_url) {
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = `${profile.profile_photo_url}${profile.profile_photo_url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      image.onerror = () => {
        avatar.replaceChildren();
        const fallback = document.createElement('span');
        fallback.textContent = initials(profile.name);
        avatar.appendChild(fallback);
      };
      avatar.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(profile.name);
      avatar.appendChild(fallback);
    }

    if (!chip.querySelector('.vv-profile-avatar-badge')) {
      const badge = document.createElement('span');
      badge.className = 'vv-profile-avatar-badge';
      badge.setAttribute('aria-hidden', 'true');
      chip.appendChild(badge);
    }
  }

  async function refreshProfileAvatar() {
    const chip = findChip();
    if (!chip) return;
    try {
      const response = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      renderChip(data.profile);
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', refreshProfileAvatar);
  window.addEventListener('pageshow', refreshProfileAvatar);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshProfileAvatar();
  });
  window.addEventListener('focus', refreshProfileAvatar);
})();
