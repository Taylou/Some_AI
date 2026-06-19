// k6/03-stress-sessions.js
//
// STRESS — Track A. Climb well past comfortable load to find where the app
// starts to degrade (rising p95, climbing error rate). Unlike the load test,
// here it is EXPECTED that thresholds may eventually break — that's the signal
// you're looking for. The thresholds below `abortOnFail` so a hopeless run
// stops early rather than burning minutes.
//
// Workload is self-sustaining: a create/delete "churn" path (POST chat ->
// DELETE) alongside reads, so the seeded pool is never exhausted.
//
// Run (benchmark stack):
//   docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/03-stress-sessions.js
import http from "k6/http";
import { check, sleep } from "k6";
import {
  BASE_URL,
  randomItem,
  seedSessions,
  createSession,
  deleteSession,
} from "./lib/helpers.js";

const POOL_SIZE = 30;

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "30s", target: 150 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    // Abort the run if the failure rate becomes hopeless.
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true }],
    http_req_duration: ["p(95)<500"], // informational ceiling — may break
  },
};

export function setup() {
  const ids = seedSessions(POOL_SIZE);
  if (ids.length === 0) {
    throw new Error("Seeding produced 0 sessions — is the benchmark stack up?");
  }
  return { ids };
}

export default function (data) {
  const roll = Math.random();

  if (roll < 0.7) {
    // Read path
    const id = randomItem(data.ids);
    const res = http.get(`${BASE_URL}/api/sessions/${id}`);
    check(res, { "history: 200": (r) => r.status === 200 });
  } else {
    // Churn path: create then delete — keeps the dataset stable under stress.
    const id = createSession();
    if (id) {
      const del = deleteSession(id);
      check(del, { "delete: 200": (r) => r.status === 200 });
    }
  }

  sleep(0.1);
}
