// Data-only FCM messages are displayed once here, including when the app is closed.
// Native PushEvent handling avoids loading a second Firebase SDK into the worker.
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const data = payload.data || {};
  event.waitUntil(self.registration.showNotification(data.title || 'Afubia Farms', {
    body: data.body || 'New shop activity', icon: '/app-icon-192.png', badge: '/favicon.svg',
    tag: data.eventId || 'afubia-activity', data: { url: data.url || '/admin' },
    vibrate: [200, 100, 200, 100, 350], silent: false, requireInteraction: data.urgent === 'true',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL(event.notification.data?.url || '/admin', self.location.origin).href;
    for (const client of windows) if (new URL(client.url).origin === self.location.origin) {
      await client.navigate(url); return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
