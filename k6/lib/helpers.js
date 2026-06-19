// k6/lib/helpers.js
//
// Shared utilities for every K6 script in this lab.
//
// BASE_URL defaults to http://api:3001 because we run K6 as a container joined
// to the app's docker network (see README3). Override it from the CLI with:
//   docker run ... -e BASE_URL=http://host.docker.internal:3001 ...
import http from "k6/http";
import { check } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://api:3001";

// A small set of prompts so seeded conversations aren't all identical.
const PROMPTS = [
  "What is Redis?",
  "Explain load testing in one sentence.",
  "Give me a fun fact about databases.",
  "What does p95 latency mean?",
  "Summarize HTTP in a tweet.",
];

export function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Reusable check: 2xx status + the response parses as JSON.
export function okCheck(res, name = "request") {
  return check(res, {
    [`${name}: status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${name}: body is JSON`]: (r) => {
      try {
        return r.json() !== null;
      } catch {
        return false;
      }
    },
  });
}

// Create one session by POSTing to /api/chat, return its sessionId (or null).
// Instant under the benchmark stack (mock Ollama); slow against real Ollama.
export function createSession() {
  const payload = JSON.stringify({
    messages: [{ role: "user", content: randomItem(PROMPTS) }],
  });
  const res = http.post(`${BASE_URL}/api/chat`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  if (res.status !== 200) return null;
  try {
    return res.json("sessionId");
  } catch {
    return null;
  }
}

// Seed `count` sessions and return the array of created sessionIds.
// Intended for use inside a K6 setup() against the benchmark (mock) stack.
export function seedSessions(count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = createSession();
    if (id) ids.push(id);
  }
  return ids;
}

// Delete a session (used by teardown / churn scenarios).
export function deleteSession(id) {
  return http.del(`${BASE_URL}/api/sessions/${id}`);
}
