import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getMessaging,
  getToken,
  onMessage,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';

const config = self.DEMO_CONFIG;
const log = document.getElementById('log');
const jwtInput = document.getElementById('jwt');

function write(line) {
  const time = new Date().toLocaleTimeString();
  log.textContent = `[${time}] ${line}\n${log.textContent}`;
}

if (!config) {
  write(
    'config.js가 없습니다. 저장소 루트에서 npm run demo:config를 실행하세요.',
  );
} else {
  const messaging = getMessaging(initializeApp(config.firebase));

  // In the background the service worker shows the notification; while this
  // page is open, FCM hands the message here instead.
  onMessage(messaging, (payload) => {
    const { title, body } = payload.notification ?? {};
    const id = payload.data?.notificationId;
    write(`수신 (페이지 열림): ${title} — ${body} [notificationId=${id}]`);
    new Notification(title ?? '알림', { body });
  });

  document.getElementById('register').addEventListener('click', async () => {
    const jwt = jwtInput.value.trim();
    if (!jwt) {
      write('JWT를 먼저 붙여넣으세요.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        write(`알림 권한: ${permission}. 브라우저 설정에서 허용해야 합니다.`);
        return;
      }
      const registration = await navigator.serviceWorker.register(
        './firebase-messaging-sw.js',
      );
      const token = await getToken(messaging, {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: registration,
      });

      const res = await fetch(`${config.apiBaseUrl}/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ token, platform: 'web' }),
      });
      const body = await res.json();
      if (!res.ok) {
        write(`등록 실패 ${res.status}: ${body.detail ?? body.title}`);
        return;
      }
      write(
        `등록 완료 ${res.status} (${res.status === 201 ? '새 토큰' : '기존 토큰 갱신'}), device id=${body.id}`,
      );
    } catch (error) {
      write(`오류: ${error.message}`);
    }
  });
}
