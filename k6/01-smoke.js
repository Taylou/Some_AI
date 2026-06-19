// k6/01-smoke.js
//
// SMOKE TEST — the first thing you run. 1 virtual user, a handful of iterations.
// It proves the whole API is wired correctly under K6 before you pile on load.
//
// It walks the full lifecycle of a session:
//   health -> create (via /api/chat) -> get history -> list -> delete
//
// Run (benchmark stack — see README3):
//   docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/01-smoke.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, createSession, deleteSession } from "./lib/helpers.js";

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% of requests may fail
    checks: ["rate>0.99"], // >99% of checks must pass
  },
};

export default function () {
  // 1. Health
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, {
    "health: 200": (r) => r.status === 200,
    "health: status ok": (r) => r.json("status") === "ok",
  });

  // 2. Create a session through the chat endpoint
  const sessionId = createSession();
  check(null, { "chat: session created": () => sessionId !== null });
  if (!sessionId) return;

  // 3. Fetch that session's history
  const history = http.get(`${BASE_URL}/api/sessions/${sessionId}`);
  check(history, {
    "history: 200": (r) => r.status === 200,
    "history: has messages": (r) => (r.json("messages") || []).length > 0,
  });

  // 4. The session shows up in the index
  const list = http.get(`${BASE_URL}/api/sessions`);
  check(list, {
    "list: 200": (r) => r.status === 200,
    "list: includes our session": (r) =>
      (r.json("sessions") || []).includes(sessionId),
  });

  // 5. Clean up
  const del = deleteSession(sessionId);
  check(del, { "delete: 200": (r) => r.status === 200 });

  sleep(0.5);
}
