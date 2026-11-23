/* Capacitor is injected by the installed native shell on its first-party origin. */
(() => {
  'use strict';
  const cap = window.Capacitor;
  if (location.origin !== 'https://app.voxelveda.com' || !cap?.isNativePlatform?.()) return;
  const nativePlatform = cap.getPlatform?.();
  if (!['android','ios'].includes(nativePlatform)) return;

  let push;
  if (cap.isPluginAvailable?.('PushNotifications')) {
    push = cap.Plugins?.PushNotifications || cap.registerPlugin?.('PushNotifications');
  }
  const listeners = new Set();
  const tokenListeners = new Set();
  let pendingTap;
  let registering;
  let completeRegistration;
  let handleReady;

  function noticeType(notification) {
    const kind = notification?.data?.kind;
    return kind === 'release' || kind === 'team' ? kind : null;
  }
  function publishTap(notice, tapped) {
    const kind = noticeType(notice);
    if (!kind) return;
    if (!listeners.size) {
      if (tapped || !pendingTap?.tapped) pendingTap = { kind, tapped };
    }
    else for (const listener of listeners) listener({kind, tapped});
  }
  function attach() {
    if (!push || handleReady) return;
    handleReady = Promise.all([
      push.addListener('registration', data => {
        if (typeof data?.value !== 'string' || !data.value) return;
        const token = {platform:nativePlatform,token:data.value};
        if (completeRegistration) completeRegistration(null,token);
        else for (const listener of tokenListeners) listener(token);
      }),
      push.addListener('registrationError', () => completeRegistration?.(new Error('Native push registration is unavailable.'))),
      push.addListener('pushNotificationActionPerformed', event => {
        if (event?.actionId === 'tap') publishTap(event.notification, true);
      }),
      push.addListener('pushNotificationReceived', event => publishTap(event, false))
    ]);
    handleReady.catch(() => {});
  }
  const normalizePermission = data => ['granted','denied'].includes(data?.receive) ? data.receive : 'prompt';
  async function permission(method) {
    if (!push) return 'unsupported';
    const result = normalizePermission(await push[method]());
    if (result !== 'granted' || nativePlatform !== 'android') return result;
    const state = await cap.Plugins?.VoxelVedaApp?.getAppInfo?.();
    return state?.notificationsEnabled === false ? 'denied' : result;
  }
  async function register() {
    if (!push) throw new Error('Install the push-enabled Voxel Veda app to enable notifications.');
    if (registering) return registering;
    attach();
    registering = new Promise((resolve,reject) => {
      const timer = setTimeout(() => completeRegistration?.(new Error('Native push registration timed out.')),15000);
      completeRegistration = (error,token) => {
        clearTimeout(timer);
        completeRegistration = null;
        if (error) reject(error); else resolve(token);
      };
      handleReady.then(() => push.register()).catch(() => completeRegistration?.(new Error('Native push configuration is unavailable.')));
    }).finally(() => { registering = null; });
    return registering;
  }

  window.VVNativeDevicePush = {
    available: Boolean(push),
    info: async () => {
      const info = await cap.Plugins?.VoxelVedaApp?.getAppInfo?.();
      return { platform:nativePlatform, version:info?.versionName, build:info?.versionCode,
        pushConfigured: nativePlatform === 'ios' || info?.pushConfigured === true };
    },
    permission: () => permission('checkPermissions'),
    request: () => permission('requestPermissions'),
    register,
    unregister: async () => push?.unregister(),
    onTap(listener) {
      listeners.add(listener);
      if (pendingTap) { listener(pendingTap); pendingTap = null; }
      attach();
      return () => listeners.delete(listener);
    },
    onToken(listener) { tokenListeners.add(listener); return () => tokenListeners.delete(listener); }
  };
  attach();
})();
