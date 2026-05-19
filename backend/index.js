const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");

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
// TODO (student): Retrieve the full chat history for a given session.
//
// Steps to implement:
//  1. Use redis.lrange(sessionKey(sessionId), 0, -1) to get all messages
//     from the list. LRANGE returns all elements from index 0 to -1 (end).
//  2. Each element is a JSON string — parse it with JSON.parse().
//  3. Return { sessionId, messages: [...parsed messages] }
//  4. If the session does not exist (empty array), return a 404 with
//     { error: "Session not found" }
//
// Hint: sessionKey(sessionId) builds the correct Redis key for you.
// --------------------------------------------------------------------------
app.get("/api/sessions/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  // TODO (student): implement this route
  res.status(501).json({ error: "Not implemented yet — complete this as part of the lab exercise." });
});

// --------------------------------------------------------------------------
// DELETE /api/sessions/:sessionId
//
// TODO (student): Delete a session and its chat history from Redis.
//
// Steps to implement:
//  1. Use redis.del(sessionKey(sessionId)) to remove the message list.
//  2. Use redis.srem("sessions", sessionId) to remove the ID from the index.
//  3. Return { success: true, sessionId } on success.
//  4. If the session did not exist (del returns 0), return a 404.
//
// Hint: redis.del() returns the number of keys that were deleted.
// --------------------------------------------------------------------------
app.delete("/api/sessions/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  // TODO (student): implement this route
  res.status(501).json({ error: "Not implemented yet — complete this as part of the lab exercise." });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Ollama target: ${OLLAMA_URL}`);
  console.log(`Redis: ${REDIS_URL}`);
});
