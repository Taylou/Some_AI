const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");
const swaggerUi = require("swagger-ui-express");
const openapiSpec = require("./swagger");

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
//  Interactive UI:  GET /api/docs
//  Raw spec (JSON): GET /api/docs.json   (import into Postman/Insomnia, codegen…)
//
// The contract itself lives in ./swagger.js.

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, { customSiteTitle: "some-ai API docs" })
);
app.get("/api/docs.json", (req, res) => res.json(openapiSpec));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check — useful to confirm the server is reachable
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", redis: redis.status, ollama: OLLAMA_URL });
});

// --------------------------------------------------------------------------
// POST /api/chat
//
// Body: {
//   sessionId?: string,   // omit to start a new session
//   model: string,        // e.g. "deepseek-r1:1.5b"
//   messages: [{ role, content }]
// }
//
// What this does (PRE-IMPLEMENTED):
//  1. Generates a sessionId if one is not provided
//  2. Forwards the messages to Ollama's /api/chat endpoint
//  3. Saves the last user message and the assistant reply to Redis
//  4. Returns the assistant reply and the sessionId
// --------------------------------------------------------------------------
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

// --------------------------------------------------------------------------
// GET /api/sessions
//
// Returns the list of all session IDs stored in Redis.
//
// What this does (PRE-IMPLEMENTED):
//  - Reads the "sessions" Redis SET and returns its members as an array
// --------------------------------------------------------------------------
app.get("/api/sessions", async (req, res) => {
  try {
    const sessionIds = await redis.smembers("sessions");
    res.json({ sessions: sessionIds });
  } catch (err) {
    console.error("/api/sessions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/sessions/:sessionId
//
// Returns the full chat history for a session. Reads the session's Redis LIST
// with LRANGE, parses each JSON entry, and responds with { sessionId, messages }.
// Returns 404 if the session has no stored messages.
// --------------------------------------------------------------------------
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

// --------------------------------------------------------------------------
// DELETE /api/sessions/:sessionId
//
// Deletes a session and its chat history. Removes the session's Redis LIST
// (DEL) and its id from the "sessions" SET (SREM), then responds with
// { success: true, sessionId }. Returns 404 if the session did not exist.
// --------------------------------------------------------------------------
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
  console.log(`API docs:      http://localhost:${PORT}/api/docs`);
  console.log(`Ollama target: ${OLLAMA_URL}`);
  console.log(`Redis: ${REDIS_URL}`);
});
