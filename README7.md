# Lab 7 — Observability: Metrics with Prometheus & Grafana

[Lab 6](README6.md) automated the **left half** of the DevOps lifecycle — Code → Build → Test → CI.
This lab picks up the **right half**: **Operate / Monitor**. Once an app is running, you need to *see*
what it's doing — how many requests it's serving, how fast, and how often it fails. That's
**observability**, and it closes the DevOps loop: what you learn from monitoring feeds the next round
of planning.

```
 Plan → Code → Build → Test → Release → Deploy → Operate → MONITOR
   ▲                                                          │
   └──────────────────────  feedback loop  ───────────────────┘
```

We deliberately skip the account-and-billing-heavy **Deploy** phase and do the whole thing locally in
Docker Compose. The payoff at the end: **watch a live Grafana dashboard while a k6 load test
([Lab 3](README3.md)) hammers the API** — the Test lab and the Monitor lab, wired together.

---

## The three moving parts

Monitoring here is a small pipeline. Each piece has one job:

```
 ┌───────────────┐   scrape /metrics    ┌──────────────┐   query    ┌───────────┐
 │  Express API  │◀─────────────────────│  Prometheus  │◀───────────│  Grafana  │
 │  /metrics     │   every 5s (pull)    │  time-series │   PromQL   │ dashboards│
 └───────────────┘                      │   database   │            └───────────┘
 ┌───────────────┐   scrape /metrics    │              │
 │ redis-exporter│◀─────────────────────│              │
 └───────────────┘                      └──────────────┘
```

- **The app exposes metrics.** The backend now serves `GET /metrics` in Prometheus's plain-text
  format (via the [`prom-client`](https://github.com/siimon/prom-client) library).
- **Prometheus collects them.** It **pulls** — on a schedule it GETs each target's `/metrics` and
  stores the numbers as time series. (Nobody pushes to Prometheus; it goes and fetches.)
- **Grafana visualizes them.** It queries Prometheus with **PromQL** and draws graphs.
- **redis-exporter** is a little adapter that exposes Redis's internal `INFO` stats as `/metrics` so
  Prometheus can scrape Redis too.

---

## What was added to the backend

Open [backend/index.js](backend/index.js). Three small pieces, all near the top:

**1. A registry + default process metrics** — CPU, memory, event-loop lag, garbage collection:

```js
const client = require("prom-client");
const register = new client.Registry();
client.collectDefaultMetrics({ register });
```

**2. An HTTP histogram + timing middleware** — the app's "RED" signals (Rate, Errors, Duration):

```js
const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

app.use((req, res, next) => {
  const stop = httpDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    stop({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});
```

> **Why `req.route.path` and not `req.path`?** A histogram creates one time series per unique label
> combination. If we labelled by the raw URL, every session id (`/api/sessions/abc-123…`) would spawn
> a *new* series and eventually melt Prometheus — the classic **high-cardinality** trap. `req.route.path`
> collapses them all to the template `/api/sessions/:sessionId`. Bounded labels are the golden rule of
> metrics.

**3. The scrape endpoint:**

```js
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
```

The only new dependency is `prom-client` (added to [backend/package.json](backend/package.json)).

---

## Step 1 — Start the stack with monitoring

The monitoring services live in a **layered override**, [docker-compose.observability.yml](docker-compose.observability.yml)
— the same pattern as the k6 override in [Lab 3](README3.md). Bring up the base stack, the mock-Ollama
stack (so load is fast and deterministic), and monitoring, all at once:

```bash
docker compose -p some-ai \
  -f docker-compose.yml -f docker-compose.k6.yml -f docker-compose.observability.yml \
  up -d --build
```

This adds three containers: **prometheus** (`:9090`), **grafana** (`:3000`), and **redis-exporter**
(`:9121`). The existing ports (API `3001`, RedisInsight `5540`, Redis `6379`) are untouched.

## Step 2 — Confirm the app is emitting metrics

```bash
curl -s http://localhost:3001/metrics | grep http_request_duration_seconds_count
```

You'll see one line per route/status you've hit — e.g.
`http_request_duration_seconds_count{method="GET",route="/api/health",status_code="200"} 3`.

## Step 3 — Check Prometheus is scraping

Open **[http://localhost:9090/targets](http://localhost:9090/targets)**. The `api`, `redis`, and
`prometheus` jobs should all show **UP**. (If `api` is DOWN, the container isn't reachable yet — give
it a few seconds and refresh.) The scrape config lives in
[monitoring/prometheus.yml](monitoring/prometheus.yml).

Try a query on **[http://localhost:9090/graph](http://localhost:9090/graph)**:

```promql
sum by (route) (rate(http_request_duration_seconds_count[1m]))
```

## Step 4 — Open Grafana

Open **[http://localhost:3000](http://localhost:3000)**. Anonymous access is on for the lab, so you
land straight in (admin login is `admin` / `admin` if you want it). The **Prometheus** datasource and
the **"some-ai — API & Redis (RED)"** dashboard are already provisioned — find it under
*Dashboards → some-ai*. No manual setup: the files in
[monitoring/grafana/provisioning/](monitoring/grafana/provisioning) wire it all on boot.

The dashboard shows the three RED signals for the API (request rate by route, 5xx error rate, p95/p99
latency) plus two Redis panels (commands/sec, clients & memory).

---

## Step 5 — The payoff: watch it move under load

This is where the Test and Monitor labs meet. Keep the Grafana dashboard open, then in another
terminal drive load with a k6 script from [Lab 3](README3.md):

```bash
docker run --rm --network some-ai_default \
  -e BASE_URL=http://api:3001 \
  -v "$PWD/k6:/scripts" \
  grafana/k6 run /scripts/05-chat.js
```

Within a few seconds the **request-rate** and **latency** panels climb. Because the app records every
request, the dashboard reflects the load with no extra wiring.

### Bonus: k6's own metrics, in the same Prometheus

The panels above are the *server's* view. k6 also measures the client side (its own request timings,
iterations, VUs). Because we started Prometheus with `--web.enable-remote-write-receiver`, k6 can push
those straight in:

```bash
docker run --rm --network some-ai_default \
  -e BASE_URL=http://api:3001 \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
  -v "$PWD/k6:/scripts" \
  grafana/k6 run -o experimental-prometheus-rw /scripts/05-chat.js
```

Now `k6_*` series (e.g. `k6_http_req_duration`) are queryable in Grafana → **Explore**. Want the full
official k6 dashboard? Import grafana.com dashboard **19665** (Dashboards → New → Import) — it needs
internet the first time.

> **Windows note:** if you run these `docker run` commands in **Git Bash**, prefix them with
> `MSYS_NO_PATHCONV=1` so `/scripts/...` isn't rewritten into a Windows path. PowerShell and WSL are
> unaffected. (Same gotcha as [Lab 6](README6.md).)

---

## How CI checks this (Lab 6 tie-in)

The pipeline in [.github/workflows/ci.yml](.github/workflows/ci.yml) now guards the monitoring setup too:

- The **`api-k6`** job asserts `GET /metrics` responds and exposes `http_request_duration_seconds` —
  so a broken instrumentation fails the build.
- A new **`monitoring`** job runs `promtool check config` on the Prometheus file and parses the Grafana
  dashboard JSON — catching a typo before it ever reaches a running Grafana.

---

## Appendix (optional) — seeing the packets with Wireshark / tshark

Metrics tell you *what* is happening in aggregate; sometimes you want to watch the actual **network
traffic** — the raw request/response packets between the API, Redis, and Ollama. That's a
**troubleshooting** tool, not part of the monitoring loop, but it's a great way to make the plumbing
concrete.

You can capture traffic on a container's network without installing anything on your host, using the
[`nicolaka/netshoot`](https://github.com/nicolaka/netshoot) toolbox (which bundles `tcpdump` and
`tshark`, the CLI Wireshark). This shares the API container's network namespace and watches its
Redis traffic:

```bash
docker run --rm --net container:some-ai-api nicolaka/netshoot \
  tshark -i any -f "tcp port 6379"
```

Hit the API in another terminal (`curl -s http://localhost:3001/api/sessions`) and you'll see the
`SET` / `LRANGE` / `SMEMBERS` commands flow to Redis. To open the capture in the **Wireshark GUI**
instead, write a `.pcap` and load it:

```bash
docker run --rm --net container:some-ai-api -v "$PWD:/out" nicolaka/netshoot \
  tshark -i any -f "tcp port 6379" -w /out/redis.pcap -a duration:15
# then: open redis.pcap in Wireshark
```

> This is for learning/debugging on your own machine. Capturing traffic you don't own is a different
> matter — don't point it at networks you're not authorised to inspect.

---

## Gotchas

| Symptom | Cause / fix |
|---------|-------------|
| Prometheus target `api` is **DOWN** | The API container isn't up yet, or `/metrics` errored. `docker compose -p some-ai logs api`, then refresh the Targets page. |
| Grafana dashboard is **empty** | No traffic yet — hit the API or run a k6 script. Also confirm the datasource is green under *Connections → Data sources*. |
| Latency panel shows **NaN / gaps** | `histogram_quantile` needs a few samples across buckets. Generate some load and widen the time range. |
| A route floods Prometheus with series | A label became high-cardinality (raw ids in the `route` label). Keep labels bounded — use `req.route.path`, never `req.path`. |
| k6 remote-write fails with 404/405 | Prometheus wasn't started with `--web.enable-remote-write-receiver` (it is, in the override — make sure you included `-f docker-compose.observability.yml`). |

## What's next

- **Alerting** — add Prometheus *alert rules* (e.g. p95 latency > 1s for 5m) and route them via
  Alertmanager. That's the "act on what you monitor" step.
- **Logs & traces** — metrics are one of the three pillars of observability. Add structured logging
  (pino) and distributed tracing (OpenTelemetry) for the full picture.
- **Deploy (CD)** — the one lifecycle phase still missing: ship the image to a host so this dashboard
  watches a *real* running service, not just localhost.
