// Shows pushes while the demo page is closed or in the background. Messages
// with a `notification` part are displayed by the Firebase SDK itself.

// Registered before the Firebase SDK loads: the SDK's own click handler stops
// other listeners. A click opens (or focuses) the demo page, which marks the
// notification read with PATCH /me/notifications/{id}/read.
self.addEventListener('notificationclick', (event) => {
  // The SDK keeps the FCM message on the notification as FCM_MSG.
  const id = event.notification.data?.FCM_MSG?.data?.notificationId;
  if (!id) return;
  event.notification.close();
  event.waitUntil(openDemo(id));
});

async function openDemo(id) {
  const tabs = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const tab = tabs.find((t) => t.url.startsWith(self.registration.scope));
  if (tab) {
    tab.postMessage({ type: 'notification-clicked', notificationId: id });
    return tab.focus();
  }
  const url = new URL(
    `./?read=${encodeURIComponent(id)}`,
    self.registration.scope,
  );
  return clients.openWindow(url.href);
}

importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js',
);
importScripts('./config.js');

firebase.initializeApp(self.DEMO_CONFIG.firebase);
firebase.messaging();
