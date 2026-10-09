// k6: how many single-notification requests the API accepts per second, and
// how long they take. Each request has a new Idempotency-Key, so every one
// writes a notification and adds a job.
//
// docker run --rm -i -e API=... -e API_KEY=... -e VUS=... grafana/k6:2.2.0 run - < intake.js
import http from 'k6/http';
import { check } from 'k6';

const API = __ENV.API;
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    intake: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '30s',
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.post(
    `${API}/notifications`,
    JSON.stringify({
      channel: 'email',
      category: 'transactional',
      templateKey: 'exp',
      recipient: { email: `k6-${__VU}-${__ITER}@example.com` },
      variables: { n: String(__ITER) },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
    },
  );
  check(res, { 202: (r) => r.status === 202 });
}
