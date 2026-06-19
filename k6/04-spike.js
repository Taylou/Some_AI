// k6/04-spike.js
//
// SPIKE — Track A. Traffic jumps from near-idle to a large burst almost
// instantly, holds briefly, then drops. This models a sudden rush (a link goes
// viral, a cron fan-out, etc.). Watch two things in the summary:
//   - how high p95/p99 climb during the burst
//   - whether the error rate recovers once load drops back down
//
// Run (benchmark stack):
//   docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/04-spike.js
import http from "k6/http";
import { check } from "k6";
import { BASE_URL, randomItem, seedSessions } from "./lib/helpers.js";

const POOL_SIZE = 20;

export const options = {
  stages: [
    { duration: "10s", target: 5 }, // baseline
    { duration: "5s", target: 200 }, // sudden spike
    { duration: "20s", target: 200 }, // hold the burst
    { duration: "5s", target: 5 }, // drop back
    { duration: "10s", target: 5 }, // recovery window
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.10"], // a spike may shed some requests
    http_req_duration: ["p(95)<800"],
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
  // Cheap, deterministic reads so the spike stresses the app, not the workload.
  const id = randomItem(data.ids);
  const res = http.get(`${BASE_URL}/api/sessions/${id}`);
  check(res, { "history: 200": (r) => r.status === 200 });
}
