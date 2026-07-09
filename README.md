# Redis + Ollama Lab

[![CI](https://github.com/Taylou/Some_AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Taylou/Some_AI/actions/workflows/ci.yml)

A React Native chat app powered by Ollama AI models. In this lab you will add a **Redis database** and an **Express backend** using Docker Compose so that chat conversations are persisted across sessions.

---

## Architecture

```
┌─────────────────────────┐
│   React Native App      │  (Expo — runs on your phone / emulator)
│   frontend/             │
│     components/         │
│       ollamaClient.js   │
│       service.js        │
│       ChatView.js       │
└────────────┬────────────┘
             │  HTTP (port 3001)
             ▼
┌─────────────────────────┐      ┌──────────────────────┐
│   Express API           │─────▶│   Ollama             │
│   backend/index.js      │      │   (host, port 11434) │
│   (Docker, port 3001)   │      └──────────────────────┘
└────────────┬────────────┘
             │  ioredis
             ▼
┌─────────────────────────┐      ┌──────────────────────────┐
│   Redis 7               │◀────▶│   RedisInsight (GUI)     │
│   (Docker, port 6379)   │      │   (Docker, port 5540)    │
└─────────────────────────┘      └──────────────────────────┘
```

The Express backend sits between the app and Ollama. It:
- Forwards chat messages to Ollama
- Stores every conversation in Redis (persisted to disk via AOF)
- Exposes REST endpoints so the app can retrieve past sessions

**RedisInsight** is a web-based GUI for browsing the data inside Redis. Open `http://localhost:5540` to see the keys, lists, and sets your app has created — Redis itself does not speak HTTP, so you cannot view it directly in a browser.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Runs Redis + API containers |
| [Node.js](https://nodejs.org/) | 18 or 20 | Expo CLI and (optionally) local backend dev |
| [Expo Go](https://expo.dev/go) | Latest | Run the app on your phone |
| Ollama | Running on your network | Provides the AI models |

Make sure Docker Desktop is **running** before you start.

---

## Step 1 — Open the project

You should see this two-service layout:

```
some-ai/
├── frontend/              ← Expo / React Native app
│   ├── App.js
│   ├── index.js           ← Expo entry point
│   ├── app.json
│   ├── package.json
│   ├── assets/
│   └── components/
│       ├── ChatView.js
│       ├── ollamaClient.js
│       └── service.js
├── backend/               ← Express API
│   ├── .env.example
│   ├── Dockerfile
│   ├── index.js           ← Express entry point
│   └── package.json
├── docker-compose.yml     ← Redis + API services
└── README.md
```

> **Why two folders?** The Expo app and the Express API are two separate projects with their own `package.json` and `index.js`. Keeping them in sibling folders makes the boundary obvious, gives each its own `node_modules`, and matches standard multi-service repo layout.

---

## Step 2 — Set your Ollama URL

Open `docker-compose.yml` and find the `OLLAMA_URL` under the `api` service:

```yaml
environment:
  - OLLAMA_URL=http://host.docker.internal:11434
```

**`host.docker.internal`** is a special hostname that lets the API container reach services running on your **host machine** (i.e. the laptop running Docker). It works on Docker Desktop (Windows/Mac) and — thanks to the `extra_hosts` line in `docker-compose.yml` — on Linux too.

Three scenarios:

| Where Ollama runs | Value to use |
|-------------------|--------------|
| On the same machine as Docker | `http://host.docker.internal:11434` (default — no change needed) |
| On another machine on your LAN | `http://<that-machine-IP>:11434` (run `ipconfig` / `ip addr` on it) |
| In another Docker container | The container service name, e.g. `http://ollama:11434` |

---

## Step 3 — Start the services

From the project root:

```bash
docker compose up --build -d
```

Docker will:
1. Pull the `redis:7-alpine` image
2. Build the `backend/` image using Node 20
3. Start both containers and link them on a shared network

Check that both containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                       STATUS
some-ai-api                running
some-ai-redis              running
some-ai-redisinsight       running
```

To view live logs:

```bash
docker compose logs -f
```

---

## Step 4 — Verify Redis is working

Open a Redis shell inside the container:

```bash
docker exec -it some-ai-redis redis-cli
```

At the `redis-cli` prompt:

```
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> exit
```

If you see `PONG`, Redis is healthy.

---

## Step 5 — Test the API

### Health check

```bash
curl http://localhost:3001/api/health
```

Expected:

```json
{ "status": "ok", "redis": "ready", "ollama": "http://host.docker.internal:11434" }
```

### Send a chat message

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-r1:1.5b",
    "messages": [{ "role": "user", "content": "Hello! What is Redis?" }]
  }'
```

Expected (the `sessionId` will differ):

```json
{
  "sessionId": "a1b2c3d4-...",
  "reply": "Redis is an in-memory data structure store..."
}
```

> **Tip:** Copy the `sessionId` from the response — you will need it in the exercises below.

### List all sessions

```bash
curl http://localhost:3001/api/sessions
```

Expected:

```json
{ "sessions": ["a1b2c3d4-..."] }
```

---

## Step 6 — Install frontend dependencies and start Expo

Open a **new terminal** (leave Docker running in the first one) and install the Expo app's dependencies:

```bash
cd frontend
npm install
npm start
```

This boots the Expo dev server. Scan the QR code with Expo Go on your phone, or press `w` for web / `a` for Android emulator.

> The backend has its own `package.json` inside `backend/`. You don't need to `npm install` it on your host — Docker handles that.

---

## Step 7 — Point the app at your backend

The app is **already pre-wired** to call the Express backend (not Ollama directly). Look at `frontend/components/ollamaClient.js` to see how it works — `chat()` POSTs to `/api/chat` and the backend handles persistence + the Ollama proxy.

The only thing you need to change is the **IP address** so your phone / emulator can reach the backend over the network. Open `frontend/components/ollamaClient.js`:

```js
constructor({ baseUrl = "http://172.24.208.1:3001" } = {}) {
```

Replace the IP with your **own machine's LAN IP** (the laptop running Docker):

- **Windows:** `ipconfig` → look for "IPv4 Address" under your active Wi-Fi adapter
- **Mac / Linux:** `ifconfig` or `ip addr` → look for `inet 192.168.x.x` or `inet 10.x.x.x`

> Do **not** use `localhost` — on a phone, "localhost" is the phone itself, not your laptop. The web emulator (`npm run web`) is the one exception — `localhost` works there.

After saving, reload the app and send a message. Tail the backend logs to confirm it's being hit:

```bash
docker compose logs -f api
```

You should see `POST /api/chat` lines appear with each message.

---

## Step 8 — Browse Redis data in RedisInsight

Open your browser at **[http://localhost:5540](http://localhost:5540)**.

On first launch:

1. Accept the EULA / terms.
2. Click **"Add Redis database"**.
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Host  | `redis` |
   | Port  | `6379` |
   | Database alias | `some-ai` (or anything) |

4. Click **"Add Database"**.

The hostname `redis` works because RedisInsight runs in the same docker-compose network as the Redis container — they resolve each other by service name.

Once connected, click the database, then **"Browser"** in the left nav. You should see:

- `sessions` — a **SET** containing all session UUIDs
- `session:<uuid>` — one **LIST** per conversation. Click into it to see every message (each entry is a JSON object with `role`, `content`, and `timestamp`).

Send another message from the app — refresh RedisInsight and watch the list grow in real time. This is the easiest way to **see** what the backend is doing.

---

## Student Exercises

The following endpoints are stubbed in `backend/index.js` with `// TODO (student):` comments. Your job is to implement them.

### Exercise 1 — Retrieve a session's chat history

**Endpoint:** `GET /api/sessions/:sessionId`

**Goal:** Return all messages stored for a session.

**Redis commands to use:**
- `redis.lrange(key, 0, -1)` — returns all elements of a list
- `JSON.parse(entry)` — each element is a JSON string

**Expected response:**

```json
{
  "sessionId": "a1b2c3d4-...",
  "messages": [
    { "role": "user",      "content": "Hello!",  "timestamp": "..." },
    { "role": "assistant", "content": "Hi there!", "timestamp": "..." }
  ]
}
```

Return a `404` if the session does not exist (hint: an empty array means no session).

**Test it:**

```bash
curl http://localhost:3001/api/sessions/<YOUR_SESSION_ID>
```

---

### Exercise 2 — Delete a session

**Endpoint:** `DELETE /api/sessions/:sessionId`

**Goal:** Remove a session and its history from Redis.

**Redis commands to use:**
- `redis.del(key)` — deletes a key, returns the count of deleted keys
- `redis.srem("sessions", sessionId)` — removes the ID from the sessions index

**Expected response:**

```json
{ "success": true, "sessionId": "a1b2c3d4-..." }
```

Return a `404` if the session did not exist.

**Test it:**

```bash
curl -X DELETE http://localhost:3001/api/sessions/<YOUR_SESSION_ID>
```

---

### Exercise 3 — Add a "Clear chat" button in the app

Once Exercise 2 (`DELETE /api/sessions/:sessionId`) works, wire it into the React Native UI.

Add a button in `frontend/components/ChatView.js` that:

1. Calls `DELETE http://<YOUR_MACHINE_IP>:3001/api/sessions/<currentSessionId>` to wipe the conversation from Redis.
2. Clears the on-screen `messages` state.
3. Calls `aiRef.current.resetSession()` so the next message starts a fresh session.

**Hints:**
- The `AIService` instance already exposes `this.sessionId` and a `resetSession()` method (see `frontend/components/service.js`).
- Place the button next to the model selector in the header.
- Verify it worked by refreshing RedisInsight — the `session:<id>` list should disappear and the SET should shrink by one.

---

### Stretch Goal — Session selector UI

Add a "History" button in `frontend/components/ChatView.js` that:
1. Calls `GET /api/sessions` to fetch all session IDs
2. Lets the user pick one
3. Calls `GET /api/sessions/:sessionId` (Exercise 1) to load the messages
4. Populates the chat with the loaded history

---

## Testing

Automated end-to-end tests (Cypress) live in `frontend/cypress/`. They drive the
app's web build in a real browser with the backend stubbed, so you can run them
without Docker/Redis/Ollama:

```bash
cd frontend
npm install
npm run test:e2e
```

See **[README2.md](README2.md)** for the full testing guide.

### Benchmarking (K6)

Load and benchmark tests (K6) live in `k6/`, with a mock-Ollama "benchmark stack" so you can
push real concurrency at the API without the LLM dominating the numbers:

```bash
docker compose -f docker-compose.yml -f docker-compose.k6.yml up -d --build
docker run --rm -i --network some-ai_default -e BASE_URL=http://api:3001 \
  -v "${PWD}/k6:/scripts" grafana/k6 run /scripts/01-smoke.js
```

See **[README3.md](README3.md)** for the full benchmarking lab.

### API Documentation (Swagger / OpenAPI)

The backend serves interactive API docs once the stack is up:

- **Swagger UI:** [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- **Raw OpenAPI spec:** [http://localhost:3001/api/docs.json](http://localhost:3001/api/docs.json)

The contract lives in [backend/swagger.js](backend/swagger.js) plus `@openapi` JSDoc blocks on each
route. See **[README4.md](README4.md)** (Swagger setup) and **[README5.md](README5.md)** (refactor to
JSDoc-generated docs) for the full labs.

### Continuous Integration (GitHub Actions)

Every push and pull request runs the whole suite automatically — lint, the Cypress E2E tests, a K6
smoke test against the live stack, and a Docker image build — via [.github/workflows/ci.yml](.github/workflows/ci.yml).
The badge at the top of this file shows the latest `main` status.

See **[README6.md](README6.md)** for the full CI lab.

### Monitoring (Prometheus + Grafana)

The backend exposes Prometheus metrics at `/metrics`, and a layered override adds Prometheus, Grafana
(with a pre-provisioned RED dashboard), and a Redis exporter. Bring the whole thing up and open Grafana
at [http://localhost:3000](http://localhost:3000):

```bash
docker compose -p some-ai \
  -f docker-compose.yml -f docker-compose.k6.yml -f docker-compose.observability.yml \
  up -d --build
```

Then run a K6 script and watch the dashboard move in real time. See **[README7.md](README7.md)** for the
full observability lab (plus an optional Wireshark/tshark appendix).

---

## Useful Redis CLI Commands

```bash
# Open the Redis shell
docker exec -it some-ai-redis redis-cli

# List all session IDs (members of the "sessions" SET)
SMEMBERS sessions

# See all messages in a session (replace <id> with a real session ID)
LRANGE session:<id> 0 -1

# Count messages in a session
LLEN session:<id>

# Delete a session manually
DEL session:<id>
SREM sessions <id>

# Flush ALL data (danger — irreversible)
FLUSHALL

# Exit the shell
exit
```

---

## Stopping and Restarting

```bash
# Stop containers (data is preserved in the volume)
docker compose down

# Stop and wipe all Redis data
docker compose down -v

# Rebuild after changing backend code
docker compose up --build -d
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `PONG` not returned by redis-cli | Wait 10 s for the health check to pass, then retry |
| `http://localhost:6379` shows nothing in the browser | Redis is **not** an HTTP service — port 6379 speaks Redis's own binary protocol. A browser can't render it. Use **RedisInsight at [http://localhost:5540](http://localhost:5540)** to browse the data visually. |
| Chat works but `docker compose logs api` is silent | The app is talking directly to Ollama instead of the backend. Check `baseUrl` in `frontend/components/ollamaClient.js` — it must be `http://<your-laptop-IP>:3001`, not `:11434`. |
| `/api/chat` returns `502` | The API can't reach Ollama. Make sure Ollama is running on the host (`ollama serve`) and that `OLLAMA_URL` in `docker-compose.yml` is correct. If Ollama is on the same machine, it should be `http://host.docker.internal:11434`. |
| `host.docker.internal` not resolving on Linux | The `extra_hosts: ["host.docker.internal:host-gateway"]` line handles this. If it still fails, replace the URL with your host's LAN IP. |
| App can't reach backend | Make sure the IP in `frontend/components/ollamaClient.js` matches your machine's LAN IP, not `localhost` (localhost on a phone means the phone itself). |
| RedisInsight says "host not found" | When adding the database, use host `redis` (not `localhost` or `127.0.0.1`) — it's the docker-compose service name. |
| `npm install` errors in `frontend/` | Delete `frontend/node_modules` and `frontend/package-lock.json`, then re-run `npm install`. |
| Container fails to build | Run `docker compose build --no-cache` to force a fresh build. |
| Port 3001 already in use | Change the host port in `docker-compose.yml`: `"3002:3001"`. |
| Port 5540 already in use | Change the host port in `docker-compose.yml`: `"5541:5540"`. |
| Port 6379 already in use | Another Redis instance is running — stop it or change the host port. |
