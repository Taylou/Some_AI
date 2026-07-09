const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");
const swaggerUi = require("swagger-ui-express");
const openapiSpec = require("./swagger");
const client = require("prom-client");

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://172.24.208.1:11434";

// ─── Redis client ─────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);

redis.on("connect", () => console.log("Connected to Redis"));
redis.on("error", (err) => console.error("Redis error:", err.message));

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ─── Metrics (Prometheus / prom-client) ─────────────────────────────────────────
//
//  Everything the API measures is exposed as plain text at  GET /metrics , which
//  Prometheus scrapes on a schedule (see monitoring/prometheus.yml). Grafana then
//  graphs it (Lab 7 / README7).
//
//  We collect two things:
//    1. Default process metrics (CPU, memory, event-loop lag, GC) via collectDefaultMetrics.
//    2. An HTTP request histogram — the "RED" signals: Rate, Errors, Duration.

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  // Buckets tuned for a fast Redis-backed API: sub-ms to a few seconds.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Time every request. We read `req.route.path` (e.g. "/api/sessions/:sessionId")
// rather than `req.path` so session IDs don't explode the label cardinality — a
// classic Prometheus footgun. The timer stops when the response finishes.
app.use((req, res, next) => {
  const stop = httpDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    stop({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

// The scrape endpoint. Deliberately outside /api (it's operational, not part of
// the public API contract) and not documented in Swagger.
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// ─── Redis data model ─────────────────────────────────────────────────────────
//
//  sessions          →  Redis SET   — index of all session IDs
//  session:<id>      →  Redis LIST  — ordered chat messages for that session
//
//  Each list entry is a JSON string:
//    { role: "user" | "assistant", content: string, timestamp: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

async function appendMessage(sessionId, role, content) {
  const entry = JSON.stringify({ role, content, timestamp: new Date().toISOString() });
  await redis.rpush(sessionKey(sessionId), entry);
  await redis.sadd("sessions", sessionId);
}

// ─── API documentation (Swagger / OpenAPI) ─────────────────────────────────────
//
//  Interactive console:  GET /api/docs    (Swagger UI — read + "Try it out")
//  Reference site:        GET /api/redoc   (Redoc — clean, three-panel docs)
//  Raw spec (JSON):       GET /api/docs.json  (import into Postman/Insomnia, codegen…)
//
// The base definition (info, servers, components) lives in ./swagger.js; each
// route's path is documented in the `@openapi` JSDoc block above its handler.

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, { customSiteTitle: "some-ai API docs" })
);
app.get("/api/docs.json", (req, res) => res.json(openapiSpec));

// Redoc renders the same spec as a polished reference site. It's a single HTML
// page that loads the Redoc bundle from a CDN and points at /api/docs.json —
// no extra npm dependency required (needs internet the first time it loads).
const redocHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>some-ai API reference</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/api/docs.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
app.get("/api/redoc", (req, res) => res.type("html").send(redocHtml));

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Health]
 *     operationId: getHealth
 *     summary: Health check
 *     description: Confirms the server is reachable and reports Redis/Ollama status.
 *     responses:
 *       200:
 *         description: Service is up.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HealthResponse' }
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", redis: redis.status, ollama: OLLAMA_URL });
});

/**
 * @openapi
 * /api/chat:
 *   post:
 *     tags: [Chat]
 *     operationId: postChat
 *     summary: Send a chat message
 *     description: >-
 *       Forwards the conversation to Ollama, persists the last user message and
 *       the assistant reply to Redis, and returns the reply plus the session id.
 *       Omit `sessionId` to start a new conversation.
 *
 *       Note: this calls a real model, so it can take several seconds. To explore
 *       the docs quickly, run the mock-Ollama benchmark stack from README3.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ChatRequest' }
 *           example:
 *             model: deepseek-r1:1.5b
 *             messages:
 *               - { role: user, content: "Hello! What is Redis?" }
 *     responses:
 *       200:
 *         description: The assistant reply and the session id.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ChatResponse' }
 *       502: { $ref: '#/components/responses/BadGateway' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { model = "deepseek-r1:1.5b", messages = [], systemPrompt } = req.body;
    let { sessionId } = req.body;

    if (!sessionId) {
      sessionId = uuidv4();
    }

    // Build the Ollama message array (add system prompt if provided)
    const ollamaMessages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ];

    // Forward to Ollama
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: ollamaMessages, stream: false }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      return res.status(502).json({ error: `Ollama error: ${text}` });
    }

    const ollamaData = await ollamaRes.json();
    const replyContent = ollamaData.message?.content ?? "";

    // Persist the last user message and the assistant reply
    const lastUserMessage = messages.findLast((m) => m.role === "user");
    if (lastUserMessage) {
      await appendMessage(sessionId, "user", lastUserMessage.content);
    }
    await appendMessage(sessionId, "assistant", replyContent);

    res.json({ sessionId, reply: replyContent });
  } catch (err) {
    console.error("/api/chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/sessions:
 *   get:
 *     tags: [Sessions]
 *     operationId: listSessions
 *     summary: List all session ids
 *     description: Returns every session id stored in the Redis `sessions` SET.
 *     responses:
 *       200:
 *         description: Array of session ids.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SessionList' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
app.get("/api/sessions", async (req, res) => {
  try {
    const sessionIds = await redis.smembers("sessions");
    res.json({ sessions: sessionIds });
  } catch (err) {
    console.error("/api/sessions error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/sessions/{sessionId}:
 *   get:
 *     tags: [Sessions]
 *     operationId: getSession
 *     summary: Get a session's history
 *     description: Returns every stored message for the session, in order.
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         description: The session id (UUID returned by /api/chat).
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The full chat history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SessionHistory' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
app.get("/api/sessions/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const entries = await redis.lrange(sessionKey(sessionId), 0, -1);

    if (entries.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const messages = entries.map((entry) => JSON.parse(entry));
    res.json({ sessionId, messages });
  } catch (err) {
    console.error("/api/sessions/:sessionId error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/sessions/{sessionId}:
 *   delete:
 *     tags: [Sessions]
 *     operationId: deleteSession
 *     summary: Delete a session
 *     description: Removes the session's message list and its id from the index.
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         description: The session id (UUID returned by /api/chat).
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The session was deleted.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DeleteResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
app.delete("/api/sessions/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const deleted = await redis.del(sessionKey(sessionId));
    await redis.srem("sessions", sessionId);

    if (deleted === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({ success: true, sessionId });
  } catch (err) {
    console.error("DELETE /api/sessions/:sessionId error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`API docs:      http://localhost:${PORT}/api/docs   (Swagger UI)`);
  console.log(`API reference: http://localhost:${PORT}/api/redoc  (Redoc)`);
  console.log(`Ollama target: ${OLLAMA_URL}`);
  console.log(`Redis: ${REDIS_URL}`);
});
