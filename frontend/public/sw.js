// Service Worker — handles push notifications

self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     data.type + (data.matchId ? `-${data.matchId}` : ''),
      data:    { matchId: data.matchId, type: data.type },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { matchId, type } = event.notification.data || {};
  let url = '/';

  if (matchId) {
    if (type === 'match_result') url = `/match/${matchId}/result`;
    else if (type === 'match_reminder') url = `/match/${matchId}/pick`;
    else url = `/match/${matchId}/live`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Register SW in main.jsx
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
