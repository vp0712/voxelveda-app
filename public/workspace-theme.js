/* Read the saved preference before paint; retained account screens share it. */
(() => {
  'use strict';
  const key = 'voxelveda:color-mode';
  let mode = 'light';
  try {
    const saved = localStorage.getItem(key) || localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') mode = saved;
  } catch {}
  function apply(next) {
    mode = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.colorMode = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = mode === 'dark' ? '#101827' : '#F7F8FA';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.textContent = mode === 'dark' ? 'Light theme' : 'Dark theme';
      button.setAttribute('aria-label', 'Use ' + (mode === 'dark' ? 'light' : 'dark') + ' theme');
    });
    window.dispatchEvent(new CustomEvent('workspace:theme', { detail: { mode } }));
  }
  window.VoxelTheme = {
    get mode() { return mode; },
    set(next) { try { localStorage.setItem(key, next); } catch {} apply(next); },
    tokens() {
      const style = getComputedStyle(document.documentElement);
      const read = name => style.getPropertyValue('--' + name).trim();
      return { text:read('text-primary'), muted:read('text-secondary'), surface:read('surface'), border:read('border'), primary:read('primary'), series:mode === 'dark' ? ['#9EBBFF','#7DD3FC','#A9E0BA','#F6D690','#D8BCFF','#FFB7AD'] : ['#2454D6','#087C9F','#17683C','#8C5711','#6D36AB','#B42318'] };
    }
  };
  apply(mode);
  window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
  document.addEventListener('DOMContentLoaded', () => {
    const actions = document.querySelector('.topbar-actions, .profile-actions, .account-actions, .client-top, .actions');
    if (actions && !document.querySelector('[data-theme-toggle]')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'vv-theme-toggle'; button.dataset.themeToggle = '';
      actions.appendChild(button);
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => window.VoxelTheme.set(mode === 'dark' ? 'light' : 'dark')));
    apply(mode);
  });
})();
