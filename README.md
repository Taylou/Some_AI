# Redis + Ollama Lab

A React Native chat app powered by Ollama AI models. In this lab you will add a **Redis database** and an **Express backend** using Docker Compose so that chat conversations are persisted across sessions.

---

## Architecture

```
┌─────────────────────────┐
│   React Native App      │  (Expo — runs on your phone / emulator)
│   components/           │
│     ollamaClient.js     │
│     service.js          │
│     ChatView.js         │
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
┌─────────────────────────┐
│   Redis 7               │
│   (Docker, port 6379)   │
└─────────────────────────┘
```

The Express backend sits between the app and Ollama. It:
- Forwards chat messages to Ollama
- Stores every conversation in Redis (persisted to disk via AOF)
- Exposes REST endpoints so the app can retrieve past sessions

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

You should see this structure:

```
some-ai/
├── backend/           ← Express API (new)
│   ├── .env.example
│   ├── Dockerfile
│   ├── index.js
│   └── package.json
├── components/        ← React Native components
├── docker-compose.yml ← Redis + API services (new)
├── App.js
└── README.md
```

---

## Step 2 — Set your Ollama URL

Open `docker-compose.yml` and find the `OLLAMA_URL` environment variable under the `api` service. Replace the IP with the address of the machine running Ollama on your network:

```yaml
environment:
  - OLLAMA_URL=http://<YOUR_OLLAMA_IP>:11434   # ← change this
```

> **How to find the IP:** On the Ollama machine run `ipconfig` (Windows) or `ip addr` (Linux/Mac) and look for the local network address (usually `192.168.x.x` or `10.x.x.x`).

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
NAME              STATUS
some-ai-api       running
some-ai-redis     running
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
{ "status": "ok", "redis": "ready", "ollama": "http://10.2.228.127:11434" }
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

## Step 6 — Update the React Native app

The app currently talks directly to Ollama. You need to redirect it through the backend.

Open `components/ollamaClient.js` and change the `baseUrl`:

```js
// Before
constructor({ baseUrl = "http://10.2.228.127:11434" } = {}) {

// After — point to the Express backend instead
constructor({ baseUrl = "http://<YOUR_MACHINE_IP>:3001" } = {}) {
```

> Replace `<YOUR_MACHINE_IP>` with the IP of the machine running Docker (the same one you used for Ollama, or your laptop's LAN IP).

Also update the `chat()` method to use the new endpoint path:

```js
// Before
const response = await fetch(`${this.baseUrl}/api/chat`, { ... });

// After — same path, now hitting Express
const response = await fetch(`${this.baseUrl}/api/chat`, { ... });
```

The path `/api/chat` is the same, so only the base URL needs to change.

Restart the Expo app (`npm start`) and send a message. Check `docker compose logs -f api` to confirm the backend receives the request and stores it in Redis.

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

### Exercise 3 — Wire the app to the backend

Update `components/ollamaClient.js` and `components/service.js` so that:
1. The base URL points to the backend (port 3001) instead of Ollama directly
2. The chat method sends a `sessionId` in the request body so the backend can group messages into the same session
3. The `sessionId` returned by the backend is stored and reused for subsequent messages in the same conversation

**Hints:**
- `AIService` in `service.js` can hold a `this.sessionId` property
- Set it from the response of the first `/api/chat` call
- Pass it on every subsequent call

---

### Stretch Goal — Session selector UI

Add a "History" button in `ChatView.js` that:
1. Calls `GET /api/sessions` to fetch all session IDs
2. Lets the user pick one
3. Calls `GET /api/sessions/:sessionId` (Exercise 1) to load the messages
4. Populates the chat with the loaded history

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
| `/api/chat` returns `502` | Check `OLLAMA_URL` in `docker-compose.yml` — wrong IP or Ollama not running |
| App can't reach backend | Make sure the IP in `ollamaClient.js` matches your machine's LAN IP, not `localhost` (localhost on a phone means the phone itself) |
| Container fails to build | Run `docker compose build --no-cache` to force a fresh build |
| Port 3001 already in use | Change the host port in `docker-compose.yml`: `"3002:3001"` |
| Port 6379 already in use | Another Redis instance is running — stop it or change the host port |
