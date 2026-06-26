// k6/02-load-sessions.js
//
// AVERAGE LOAD — Track A (Redis-backed, deterministic endpoints).
//
// Models a steady stream of read traffic: clients checking health, listing
// sessions, and opening a conversation's history. setup() seeds a pool of
// sessions once; VUs then read from that pool (reads don't consume it).
//
// This is "is the app comfortable at normal traffic?" — thresholds should pass.
//
// Run (benchmark stack):
//   docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/02-load-sessions.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, randomItem, seedSessions } from "./lib/helpers.js";

const POOL_SIZE = 20;

export const options = {
  stages: [
    { duration: "30s", target: 50 }, // ramp up to 50 VUs
    { duration: "50s", target: 20 }, // hold
    { duration: "10s", target: 10 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<50"], // tune to your hardware
    checks: ["rate>0.99"],
  },
  setupTimeout: "5m",
};

// Runs once before the test. Returns data passed to every VU iteration.
export function setup() {
  const ids = seedSessions(POOL_SIZE);
  if (ids.length === 0) {
    throw new Error(
      "Seeding produced 0 sessions — is the benchmark stack up (mock Ollama)?"
    );
  }
  return { ids };
}

export default function (data) {
  // Weighted mix: mostly history reads, some list calls, a few health checks.
  const roll = Math.random();

  if (roll < 0.6) {
    const id = randomItem(data.ids);
    const res = http.get(`${BASE_URL}/api/sessions/${id}`);
    check(res, { "history: 200": (r) => r.status === 200 });
  } else if (roll < 0.9) {
    const res = http.get(`${BASE_URL}/api/sessions`);
    check(res, { "list: 200": (r) => r.status === 200 });
  } else {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, { "health: 200": (r) => r.status === 200 });
  }

  sleep(Math.random() * 0.5); // think time
}
