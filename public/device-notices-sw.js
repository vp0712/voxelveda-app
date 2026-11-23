/* This worker is notification-only. It never intercepts requests or caches app data. */
'use strict';

const paths = { release: '/updates', team: '/dashboard?team_activity=1' };

function openStore() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('vv-device-notices', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function settings(value, write = false) {
  const db = await openStore();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction('state', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('state');
    const request = write ? (value ? store.put(value,'subscription') : store.delete('subscription')) : store.get('subscription');
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
self.addEventListener('message', event => {
  if (event.data?.type === 'vv-push-settings' && event.source?.type === 'window') {
    event.waitUntil(settings(event.data.settings, true).catch(() => {}));
  }
});
self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { return; }
  if (!Object.hasOwn(paths, data?.kind)) return;
  const tag = typeof data.tag === 'string' && /^vv-(release|team)-\d+$/.test(data.tag) ? data.tag : 'vv-' + data.kind;
  event.waitUntil(self.registration.showNotification('Voxel Veda', {
    body: data.kind === 'team' ? 'Voxel Veda activity is ready' : 'An app update is available',
    icon: '/favicon-192.png', badge: '/favicon-192.png', tag, renotify: false, data: { kind: data.kind }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const kind = event.notification.data?.kind;
  if (!Object.hasOwn(paths, kind)) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'vv-notice-tap', kind });
      return;
    }
    await self.clients.openWindow(paths[kind]);
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const saved = await settings();
    if (!saved?.headers || !saved.vapid) return;
    const key = saved.vapid.replace(/-/g,'+').replace(/_/g,'/');
    const bytes = Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4,'=')), char => char.charCodeAt(0));
    const destination = event.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    const response = await fetch('/api/device-notices/installation/destination', { method:'PATCH', credentials:'same-origin',
      headers: { ...saved.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ previous_endpoint: event.oldSubscription?.endpoint || saved.endpoint, destination: destination.toJSON() }) });
    if (!response.ok) throw new Error('Push rotation was not saved.');
    await settings({ ...saved, endpoint: destination.endpoint }, true);
  })().catch(async () => {
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.postMessage({ type: 'vv-push-rotation' });
  }));
});
