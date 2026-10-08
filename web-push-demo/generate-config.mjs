// Writes config.js from the project's .env so no Firebase or API settings are
// committed. Run from the repository root: npm run demo:config
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const required = [
  'FIREBASE_WEB_API_KEY',
  'FIREBASE_WEB_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_WEB_MESSAGING_SENDER_ID',
  'FIREBASE_WEB_APP_ID',
  'FIREBASE_VAPID_PUBLIC_KEY',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const config = {
  apiBaseUrl: process.env.DEMO_API_BASE_URL ?? 'http://localhost:3000',
  vapidKey: process.env.FIREBASE_VAPID_PUBLIC_KEY,
  firebase: {
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_WEB_APP_ID,
  },
};

// `self` is the window on the page and the global scope in the service
// worker, so both can load this one file.
const target = join(import.meta.dirname, 'config.js');
writeFileSync(
  target,
  `self.DEMO_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
console.log(`Wrote ${target}`);
