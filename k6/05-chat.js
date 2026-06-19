// k6/05-chat.js
//
// Track B — the INFERENCE path (POST /api/chat). Run it TWO ways and compare:
//
//   mock (default): against the benchmark stack (api -> mock Ollama). Measures
//                   the app's own overhead — Express + Redis — with the LLM
//                   removed. Expect a tight p95.
//
//   real:           against the NORMAL stack (api -> real Ollama), low VUs.
//                   Measures true end-to-end latency. Expect a MUCH higher p95.
//
// The gap between the two p95 numbers is the LLM's contribution; the mock
// number is your application's ceiling. That comparison is the whole point.
//
// Select the profile with CHAT_PROFILE (default "mock"):
//   # benchmark stack:
//   docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/05-chat.js
//   # normal stack, real Ollama:
//   docker run --rm -i --network some-ai_default \
//     -e BASE_URL=http://api:3001 -e CHAT_PROFILE=real \
//     -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/05-chat.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, randomItem } from "./lib/helpers.js";

const PROFILE = __ENV.CHAT_PROFILE || "mock";

const PROFILES = {
  // App overhead only — push some concurrency, expect fast responses.
  mock: {
    stages: [
      { duration: "15s", target: 20 },
      { duration: "30s", target: 20 },
      { duration: "10s", target: 0 },
    ],
    thresholds: {
      http_req_failed: ["rate<0.01"],
      http_req_duration: ["p(95)<100"], // tune to your hardware
      checks: ["rate>0.99"],
    },
  },
  // Real LLM — keep concurrency tiny; latency is dominated by the model.
  real: {
    vus: 2,
    duration: "60s",
    thresholds: {
      http_req_failed: ["rate<0.05"],
      // Loose ceiling: real models can take many seconds per reply.
      http_req_duration: ["p(95)<30000"],
      checks: ["rate>0.95"],
    },
  },
};

export const options = PROFILES[PROFILE] || PROFILES.mock;

const PROMPTS = [
  "In one sentence, what is Redis?",
  "Give me a one-line fun fact.",
  "Say hello.",
];

export default function () {
  const payload = JSON.stringify({
    messages: [{ role: "user", content: randomItem(PROMPTS) }],
  });
  const res = http.post(`${BASE_URL}/api/chat`, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: "120s", // real models can be slow
  });

  check(res, {
    "chat: 200": (r) => r.status === 200,
    "chat: non-empty reply": (r) => {
      try {
        return (r.json("reply") || "").length > 0;
      } catch {
        return false;
      }
    },
  });

  if (PROFILE === "real") sleep(0.5);
}

// NOTE: no teardown() here. Under load this script creates tens of thousands of
// sessions, and deleting them one-by-one over HTTP doesn't scale (it times out).
// To wipe the data between heavy runs, flush Redis instead — see README3
// ("Cleaning up between runs"): docker exec some-ai-redis redis-cli FLUSHALL
