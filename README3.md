# Lab 3 — Benchmark & Load Testing with K6

After the main [README.md](README.md) (Redis + Ollama + Express) and
the testing guide [README2.md](README2.md) (Cypress E2E). Cypress told us whether the app is
**correct**. K6 tells us whether it's **fast enough under concurrency** — how many requests
per second it can serve, how latency behaves as users pile on, and where it breaks.

[K6](https://k6.io/) is an open-source load-testing tool. You write the test in JavaScript,
and K6 runs it with many **virtual users (VUs)** hammering your API in parallel, then reports
latency percentiles, throughput, and error rates.

---

## The big idea: two kinds of endpoint

The whole lab hinges on one observation about this app's API:

| Class | Endpoints | Depends on | Under load |
|-------|-----------|------------|------------|
| **A — Redis-backed** | `GET /api/health`, `GET /api/sessions`, `GET /api/sessions/:id`, `DELETE /api/sessions/:id` | Redis only | **Fast & deterministic.** Sub-millisecond Redis ops. This is real *backend* benchmarking. |
| **B — Inference** | `POST /api/chat` | **Ollama (the LLM)** | **Slow & non-deterministic.** A single reply can take seconds, and the time is set by the model, not your code. |

If you naively blast `POST /api/chat` with 100 VUs, you are mostly measuring **Ollama**, not
your Express app. So this lab splits into two tracks:

- **Track A** — push the deterministic Redis endpoints hard (smoke → load → stress → spike).
  This is where you learn K6 and measure your *app's* real capacity.
- **Track B** — measure the chat path two ways and compare:
  - against a **mock Ollama** that replies instantly → isolates *your app's overhead*
  - against the **real Ollama** at low concurrency → shows *true end-to-end latency*

The gap between those two chat numbers is the LLM's contribution. The mock number is your
application's ceiling.

```
                         ┌───────────────────────────┐
   K6 (grafana/k6) ────▶ │  Express API  (api:3001)  │ ───▶ Redis (deterministic)
   many virtual users    └─────────────┬─────────────┘
                                        │ POST /api/chat
                          ┌─────────────┴──────────────┐
                          ▼                             ▼
                 mock-ollama (instant)          real Ollama (slow)
                 ── Track B "mock" ──           ── Track B "real" ──
```

---

## K6 concepts (60-second primer)

- **VU (virtual user):** one concurrent simulated client running your script in a loop.
- **Iteration:** one pass through the `default` function. More VUs = more iterations in parallel.
- **Stages / ramping:** a schedule that changes the VU count over time (ramp up, hold, ramp down).
- **`check()`:** a soft assertion (e.g. "status is 200"). Failing checks don't stop the test;
  they're reported as a pass-rate.
- **`thresholds`:** pass/fail criteria for the **whole run** — this is what turns a load test into
  a benchmark with a verdict. If a threshold is breached, K6 exits non-zero.

Metrics to read in the summary:

| Metric | Meaning |
|--------|---------|
| `http_req_duration` (avg, **p(95)**, p(99), max) | Response latency. p95 = "95% of requests were at least this fast." Watch p95/p99, not avg. |
| `http_req_failed` | Share of requests that errored. Your most important health number. |
| `http_reqs` / `iterations` | Throughput — requests (and loops) per second. |
| `checks` | Share of `check()` assertions that passed. |
| `vus` / `vus_max` | Concurrency during the run. |

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Docker Desktop (running) | Runs the app stack, the mock Ollama, and K6 |
| The base stack from [README.md](README.md) | The API + Redis you're testing |

You do **not** install K6 — you run it from the official `grafana/k6` Docker image.

---

## Step 1 — Start the benchmark stack

For Track A and the mock half of Track B, run the app with the **benchmark override**, which
adds a mock Ollama and repoints the API at it so *every* endpoint is fast and deterministic:

```bash
docker compose -f docker-compose.yml -f docker-compose.k6.yml up -d --build
```

Confirm the mock is in play — this should return an **instant** canned reply (no model wait):

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{ "messages": [{ "role": "user", "content": "hi" }] }'
```

You should see a reply like *"This is a canned reply from the mock Ollama server..."*.

> **What this override does:** [docker-compose.k6.yml](docker-compose.k6.yml) adds a
> `mock-ollama` service and sets the api's `OLLAMA_URL=http://mock-ollama:11434`. Compose merges
> the environment by key, so `REDIS_URL` and `PORT` are untouched.

---

## Step 2 — Run K6 via Docker

We run K6 as a throwaway container **joined to the app's docker network**, so it can reach the
API directly as `api:3001` (no host round-trip, more accurate numbers).

First, find the network name (it's derived from the project folder — usually `some-ai_default`):

```bash
docker network ls
```

Then run the smoke test:

```bash
docker run --rm -i \
  --network some-ai_default \
  -e BASE_URL=http://api:3001 \
  -v "${PWD}/k6:/scripts" \
  grafana/k6 run /scripts/01-smoke.js
```

Notes:
- **PowerShell:** `${PWD}` works as written. The repo path contains spaces, so keep the volume
  argument **quoted** exactly as above.
- **Can't join the network / on a different host?** Point K6 at the published port instead:
  `-e BASE_URL=http://host.docker.internal:3001` (and drop `--network`).

A green smoke run (all checks pass, `http_req_failed` 0%) means you're wired up correctly.

---

## Step 3 — Work through Track A

Run these in order against the benchmark stack. Same command as above, just swap the script.

| Script | Type | What it does | What to watch |
|--------|------|--------------|---------------|
| `01-smoke.js` | Smoke | 1 VU, full session lifecycle | Everything green before you scale up |
| `02-load-sessions.js` | Average load | Ramp to 20 VUs doing weighted reads | Thresholds should **pass**; note p95 and req/s |
| `03-stress-sessions.js` | Stress | Climb 50→100→150 VUs, reads + create/delete churn | Find where p95 climbs / errors appear — breaking the ceiling here is the *goal* |
| `04-spike.js` | Spike | Jump 5→200 VUs suddenly, then drop | How high p95/p99 spike, and whether errors **recover** afterward |

Example (load test):

```bash
docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
  -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/02-load-sessions.js
```

Each script seeds its own pool of sessions in `setup()` (instant under the mock stack), so you
don't need to prepare data by hand.

> The thresholds in these scripts (e.g. `p(95)<200`) are starting points — **tune them to your
> hardware.** On a fast laptop you might tighten them; in a constrained VM, loosen them.

---

## Step 4 — Track B: mock vs. real chat

This is the payoff. Run the **same** chat script twice.

**1. Against the mock (app overhead only)** — benchmark stack still up from Step 1:

```bash
docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
  -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/05-chat.js
```

Note the `http_req_duration` **p95** — call it `P_mock`.

**2. Against the real Ollama (true end-to-end)** — switch back to the normal stack first:

```bash
docker compose -f docker-compose.yml -f docker-compose.k6.yml down
docker compose up -d            # api now points at the REAL Ollama again
```

Make sure Ollama is running and the model is pulled (see the main README), then:

```bash
docker run --rm -i --network some-ai_default \
  -e BASE_URL=http://api:3001 -e CHAT_PROFILE=real \
  -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/05-chat.js
```

Note this **p95** — call it `P_real`. It will be far larger.

**Interpretation:**
- `P_mock` ≈ your Express + Redis overhead per chat request — the best your app can do.
- `P_real − P_mock` ≈ the model's inference time.
- The `real` profile runs only 1–2 VUs on purpose: a real model serializes work, so cranking
  concurrency just grows a queue. The lesson — *scaling the chat path means scaling the model
  (or adding model replicas), not the Express app.*

---

## Reading results & tuning

- A run **fails** (non-zero exit) if any `threshold` is breached — that's your benchmark verdict.
- Compare runs by **p95**, not average — the average hides the slow tail.
- To save a machine-readable summary, add `--summary-export=/scripts/results/summary.json` to the
  `k6 run` command (the `k6/results/` folder is git-ignored).
- Knobs you can change without editing scripts: `-e BASE_URL=...`, `-e CHAT_PROFILE=real`,
  `-e CLEANUP=false` (keep chat sessions after a run), and `MOCK_LATENCY_MS` on the mock service
  (uncomment it in [docker-compose.k6.yml](docker-compose.k6.yml)) to simulate model think-time.

---

## Roadmap

- [x] **E2E tests** (Cypress) — see [README2.md](README2.md)
- [x] **Load/benchmark tests** (K6) — this lab
- [ ] **Component tests** (Cypress Component Testing) — a future session
- [ ] Export K6 metrics to Grafana/InfluxDB for dashboards
- [ ] Wire the smoke + load runs into CI as a performance gate

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `dial tcp: lookup api ... no such host` | K6 isn't on the app network. Check `docker network ls` for the real name (often `some-ai_default`) and pass it to `--network`, or use `-e BASE_URL=http://host.docker.internal:3001` without `--network`. |
| Chat replies are slow even on the benchmark stack | The override wasn't applied — you started the app with plain `docker compose up`. Bring it up with **both** `-f` files (Step 1). Verify with the `curl` canned-reply check. |
| `Seeding produced 0 sessions` error in setup() | The API can't create sessions — either the stack is down or (on the normal stack) the real Ollama is unreachable. Use the benchmark stack for Track A. |
| Volume mount fails / "scripts not found" on Windows | Keep `-v "${PWD}/k6:/scripts"` **quoted** — the repo path has spaces. Run the command from the repo root so `${PWD}` resolves correctly. |
| `real` chat run times out at higher VUs | Expected — real models serialize. Keep the `real` profile at 1–2 VUs; raise the per-request `timeout` only if your model is very slow. |
| Mock port 11434 conflict | The mock isn't published to the host on purpose; the API reaches it over the docker network. If you see a clash, a stray `mock-ollama` container is still up — `docker compose -f docker-compose.yml -f docker-compose.k6.yml down`. |
