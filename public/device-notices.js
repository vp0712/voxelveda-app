/* Device release subscriptions and explicitly enrolled, generic AI Team alerts. */
(() => {
  'use strict';
  const api = '/api/device-notices';
  const keyName = 'vv.noticeInstallation.v1';
  const landing = { release: '/updates', team: '/dashboard?team_activity=1' };
  const native = () => window.VVNativeDevicePush;
  let device, configuration, platform, busy = false;
  let loggedIn = false;
  let settings;
  let initialized = false;

  function base64Url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function currentKey(create = false) {
    try {
      const existing = JSON.parse(localStorage.getItem(keyName) || 'null');
      if (existing && /^[a-f0-9-]{36}$/.test(existing.id) && /^[\w-]{43}$/.test(existing.key)) return existing;
      if (!create) return null;
      const next = { id: crypto.randomUUID(), key: base64Url(crypto.getRandomValues(new Uint8Array(32))) };
      localStorage.setItem(keyName, JSON.stringify(next));
      return next;
    } catch { return null; }
  }
  function headers(create = false) {
    const key = currentKey(create);
    return key ? { 'X-VV-Installation': key.id, 'X-VV-Installation-Key': key.key } : {};
  }
  async function call(path, method = 'GET', body, create = false) {
    const response = await fetch(api + path, { method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...headers(create), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body) });
    if (response.ok) return response.json();
    const error = new Error('The update settings could not be saved. Please try again.');
    error.status = response.status;
    throw error;
  }
  async function getPlatform() {
    const info = await native()?.info?.().catch(() => null);
    if (info && ['ios', 'android'].includes(info.platform)) {
      const version = info.platform === 'android' ? info.build : info.version;
      return { name: info.platform, version: version == null ? null : String(version), native: true, pushConfigured: info.pushConfigured };
    }
    const shell = window.Capacitor?.isNativePlatform?.() || /VoxelVeda(?:Android|App)/i.test(navigator.userAgent);
    return { name: 'web', native: false, oldShell: Boolean(shell) };
  }
  function permissionState() {
    if (platform.native) return native().permission();
    return Promise.resolve(window.Notification?.permission || 'unsupported');
  }
  function webAvailable() {
    return Boolean(!platform.oldShell && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  }
  async function registration() {
    return navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
  }
  function publicKey(value) {
    const text = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
  }
  async function makeDestination({ request, refresh = false }) {
    if (platform.native) {
      if (!platform.pushConfigured) return null;
      const permission = request ? await native().request() : await native().permission();
      if (permission !== 'granted') return null;
      const result = await native().register();
      return { token: result.token };
    }
    if (!webAvailable()) return null;
    const permission = request ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return null;
    await registration();
    const active = await navigator.serviceWorker.ready;
    let subscription = await active.pushManager.getSubscription();
    if (!subscription && (request || refresh)) subscription = await active.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: publicKey(configuration.vapid_public_key)
    });
    return subscription?.toJSON() || null;
  }
  async function save(destination, optedIn) {
    const eligible = device?.eligible;
    device = await call('/installation', 'PUT', { platform: platform.name, installed_version: platform.version,
      destination, release_opt_in: optedIn }, true);
    device.eligible = eligible;
    if (platform.name === 'web' && webAvailable()) {
      const worker = (await navigator.serviceWorker.getRegistration('/'))?.active;
      worker?.postMessage({ type: 'vv-push-settings', settings: destination ? { headers: headers(), endpoint: destination.endpoint,
        vapid: configuration.vapid_public_key } : null });
    }
  }
  function element(name, text, className) {
    const node = document.createElement(name);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function status(node, text) { node.textContent = text; }
  function button(label, action) {
    const node = element('button', label, 'vv-device-button');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function safeStoreRelease(release) {
    if (release.platform === 'android') return /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.voxelveda\.app$/.test(release.action_url);
    if (release.platform === 'ios') return /^https:\/\/apps\.apple\.com\/app\/id\d+$/.test(release.action_url);
    return release.platform === 'web' && release.action_url === '/updates';
  }
  function releaseCard(release, inUpdatePage) {
    const card = element('aside', '', 'vv-device-release');
    card.append(element('strong', release.platform === 'web' ? 'Latest verified web release' : 'Update available'));
    card.append(element('p', release.platform === 'web' ? 'Release ' + String(release.version).slice(0, 8) : 'Version ' + release.version));
    if (inUpdatePage && release.platform === 'web') {
      card.append(button('Open current web app', () => offerNavigation('/login', 'Open the current web release?')));
    } else {
      const link = element('a', release.platform === 'android' ? 'Open Google Play' : release.platform === 'ios' ? 'Open App Store' : 'View update');
      link.href = release.action_url;
      if (loggedIn) link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        offerNavigation(release.action_url, 'View the update?');
      });
      card.append(link);
    }
    if (!inUpdatePage) card.append(button('Dismiss', () => {
      try { localStorage.setItem('vv.seenRelease.' + release.platform, String(release.id)); } catch {}
      card.remove();
    }));
    return card;
  }
  function offerNavigation(url, text) {
    if (document.querySelector('[data-native-request-state="pending"]')) {
      if (typeof window.VoxelFeedback?.show === 'function') {
        window.VoxelFeedback.show({ kind: 'info', message: 'Wait for the current save to finish, then try again.' });
      } else {
        const message = document.querySelector('[data-vv-notice-tap] [role="status"]');
        if (message) message.textContent = 'Wait for the current save to finish, then try again.';
      }
      return;
    }
    if (typeof window.VoxelFeedback?.confirm === 'function') {
      window.VoxelFeedback.confirm('Save your current work before leaving this screen.', {
        title: text, confirmLabel: 'Continue', cancelLabel: 'Stay here'
      }).then(confirmed => { if (confirmed) location.assign(url); }).catch(() => {});
      return;
    }
    if (document.querySelector('.vv-device-confirm[open]')) return;
    const modal = element('dialog', '', 'vv-device-confirm');
    const heading = element('h2', text);
    heading.id = 'vv-device-confirm-title';
    modal.setAttribute('aria-labelledby', heading.id);
    modal.append(heading, element('p', 'Save your current work before leaving this screen.'));
    const actions = element('div', '', 'vv-device-actions');
    actions.append(button('Stay here', () => modal.close()), button('Continue', () => location.assign(url)));
    modal.append(actions);
    modal.addEventListener('close', () => modal.remove(), { once: true });
    document.body.append(modal);
    modal.showModal();
  }
  function noticeTapped(kind, { direct = false } = {}) {
    if (!Object.hasOwn(landing, kind)) return;
    if (direct && document.querySelector('[data-native-request-state="pending"]')) direct = false;
    if (direct) {
      if (document.querySelector('[data-native-dirty="true"]')) {
        offerNavigation(landing[kind], kind === 'release' ? 'View the update?' : 'Open AI Team activity?');
      } else location.assign(landing[kind]);
      return;
    }
    if (document.querySelector('[data-vv-notice-tap]')) return;
    const box = element('aside', '', 'vv-device-tap vv-device-release');
    box.dataset.vvNoticeTap = '';
    const label = kind === 'release' ? 'An app update is available' : 'Voxel Veda activity is ready';
    const output = element('p', '', 'vv-device-status');
    output.setAttribute('role', 'status');
    box.append(element('strong', label), button(kind === 'release' ? 'View update' : 'Open AI Team', () => {
      offerNavigation(landing[kind], kind === 'release' ? 'View the update?' : 'Open AI Team activity?');
    }), button('Dismiss', () => box.remove()), output);
    document.body.append(box);
  }
  async function change(action, output) {
    if (busy) return;
    busy = true;
    status(output, 'Saving…');
    const panel = output.closest('.vv-device-controls');
    panel?.setAttribute('aria-busy', 'true');
    const refreshFocus = panel?.contains(document.activeElement);
    try {
      const message = await action();
      render();
      const result = document.querySelector('.vv-device-controls [role=status]') || output;
      status(result, message || 'Saved.');
      if (refreshFocus) { result.tabIndex = -1; result.focus(); }
    } catch (error) {
      status(output, error.status === 401 || error.status === 403 ? 'Sign in with your authorised account and try again.' : error.message);
    } finally { busy = false; panel?.removeAttribute('aria-busy'); }
  }
  function controls(host, isSettings) {
    const panel = element('section', '', 'vv-device-controls');
    const output = element('p', '', 'vv-device-status');
    output.setAttribute('role', 'status');
    panel.append(element('h2', 'Device notifications'));
    const supported = configuration.push_available && (platform.native ? native()?.available && platform.version && platform.pushConfigured : webAvailable());
    if (supported || device?.release_opt_in) {
      panel.append(button(device?.release_opt_in ? 'Turn off release notifications' : 'Enable release notifications', () => change(async () => {
        if (device?.release_opt_in) {
          const destination = device.team_linked ? await makeDestination({ request: false }) : null;
          await save(destination, false);
          if (!destination && platform.native) await native()?.unregister?.().catch(() => {});
          if (!destination && webAvailable()) {
            const active = await navigator.serviceWorker.getRegistration('/');
            await (await active?.pushManager.getSubscription())?.unsubscribe();
          }
        } else {
          const destination = await makeDestination({ request: true });
          if (!destination) throw new Error('Notifications are unavailable or blocked. You can still view updates here.');
          await save(destination, true);
        }
      }, output)));
    } else {
      panel.append(element('p', 'Push is unavailable on this installation. Check the latest release here.'));
    }
    if (isSettings && loggedIn && device?.eligible) {
      const personal = element('input');
      personal.type = 'checkbox';
      personal.id = 'vv-personal-device';
      personal.checked = Boolean(device.team_linked);
      const personalLabel = element('label', 'This is my personal device');
      personalLabel.htmlFor = personal.id;
      personalLabel.prepend(personal);
      const keep = element('input');
      keep.type = 'checkbox';
      keep.id = 'vv-private-alerts-logout';
      keep.checked = Boolean(device.keep_team_after_logout);
      const keepLabel = element('label', 'Keep generic AI Team alerts after signing out');
      keepLabel.htmlFor = keep.id;
      keepLabel.prepend(keep);
      panel.append(element('p', 'Private activity details require sign-in. Set the AI Team push preference in the AI Team panel.'), personalLabel, keepLabel);
      if (supported) panel.append(button(device.team_linked ? 'Save AI Team device settings' : 'Link personal device', () => change(async () => {
        if (!personal.checked) throw new Error('Confirm this is your personal device before linking.');
        const destination = await makeDestination({ request: true });
        if (!destination) throw new Error('Allow notifications for this device to link it.');
        const current = await call('/installation/account', 'POST', {}, true);
        await save(destination, Boolean(current.release_opt_in));
        device = { ...await call('/installation/team', 'PUT', { keep_after_logout: keep.checked }), eligible: true };
        return 'Personal device linked.';
      }, output)));
    }
    if (device?.team_linked) panel.append(button('Unlink AI Team alerts', () => change(async () => {
      const eligibility = device.eligible;
      device = { ...await call('/installation/team', 'DELETE'), eligible: eligibility };
      if (!device.release_opt_in) {
        await save(null, false);
        if (platform.native) await native()?.unregister?.().catch(() => {});
        else if (webAvailable()) await (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.unsubscribe();
      }
      return 'AI Team alerts unlinked.';
    }, output)));
    panel.append(output);
    host.replaceChildren(panel);
  }
  function render() {
    if (!configuration) return;
    const entry = document.querySelector('[data-device-notices-entry]');
    settings = document.querySelector('[data-device-notices-settings]');
    if (entry) controls(entry, false);
    if (settings) controls(settings, true);
    const release = configuration.latest_release;
    const updates = document.querySelector('[data-device-release-page]');
    if (updates && !release) updates.textContent = 'No newer verified release is available for this installation.';
    if (release && safeStoreRelease(release)) {
      if (updates) updates.replaceChildren(releaseCard(release, true));
      else {
        let seen = false;
        try { seen = localStorage.getItem('vv.seenRelease.' + release.platform) === String(release.id); } catch {}
        if (!seen && !document.querySelector('[data-vv-latest-release]')) {
          const card = releaseCard(release, false);
          card.dataset.vvLatestRelease = '';
          if (entry) entry.prepend(card);
          else if (settings && location.pathname === '/profile') settings.prepend(card);
          else { card.classList.add('vv-device-tap'); document.body.append(card); }
        }
      }
    }
  }
  async function reconcile() {
    if (!platform || busy) return;
    busy = true;
    try {
      configuration = await call('/configuration?platform=' + platform.name + (platform.version ? '&installed_version=' + encodeURIComponent(platform.version) : ''));
      if (currentKey() || document.querySelector('[data-device-notices-settings]')) {
        const key = currentKey(Boolean(document.querySelector('[data-device-notices-settings]')));
        if (key) {
          device = await call('/installation');
          if (loggedIn) {
            try { device = await call('/installation/account', 'POST', {}); }
            catch (error) { if (error.status !== 401 && error.status !== 403) throw error; }
          }
          if (device.registered && (device.release_opt_in || device.team_linked)) {
            const permission = await permissionState();
            const eligible = device.eligible;
            if (permission === 'denied' || permission === 'default' || permission === 'prompt') await save(null, false);
            else if (configuration.push_available && permission === 'granted') {
              const destination = await makeDestination({ request: false, refresh: true });
              if (destination) await save(destination, device.release_opt_in);
            }
            device.eligible = eligible;
          }
        }
      }
      render();
    } catch {
      if (configuration) render();
      else {
        const host = document.querySelector('[data-device-release-page], [data-device-notices-entry], [data-device-notices-settings]');
        if (host) {
          const output = element('p', 'Could not check for updates.', 'vv-device-status');
          output.setAttribute('role', 'status');
          host.replaceChildren(output, button('Retry', reconcile));
        }
      }
    }
    finally { busy = false; }
  }
  async function init() {
    if (initialized) return;
    initialized = true;
    platform = await getPlatform();
    loggedIn = /^\/(?:admin|client|portal|profile|account|security|document\/view|quality|shop-floor|careers-admin|employee-id|invoice\/view)(?:$|\/)/.test(location.pathname);
    native()?.onTap?.(event => noticeTapped(event?.kind, { direct: event?.tapped === true }));
    native()?.onToken?.(() => reconcile());
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'vv-notice-tap') noticeTapped(event.data.kind);
      if (event.data?.type === 'vv-push-rotation') reconcile();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconcile(); });
    await reconcile();
  }
  window.VVDeviceNotices = { headers, tapped: noticeTapped };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
