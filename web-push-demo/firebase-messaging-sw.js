// Shows pushes while the demo page is closed or in the background. Messages
// with a `notification` part are displayed by the Firebase SDK itself.
importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js',
);
importScripts('./config.js');

firebase.initializeApp(self.DEMO_CONFIG.firebase);
firebase.messaging();
