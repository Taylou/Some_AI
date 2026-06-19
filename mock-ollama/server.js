// mock-ollama/server.js
//
// A zero-dependency stand-in for Ollama, used ONLY for load testing.
//
// The real backend (backend/index.js) POSTs to `${OLLAMA_URL}/api/chat` and
// reads `ollamaData.message.content` from the JSON response. This stub returns
// that exact shape instantly, so K6 can measure the *app's* overhead (Express +
// Redis) without the multi-second, non-deterministic latency of a real LLM.
//
// Optional: set MOCK_LATENCY_MS to simulate model "think time" (default 0).

const http = require("http");

const PORT = process.env.PORT || 11434;
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 0);

const REPLY =
  "This is a canned reply from the mock Ollama server (used for load testing).";

const server = http.createServer((req, res) => {
  // Some clients probe other paths — answer anything non-chat with a plain 200.
  if (req.method !== "POST" || !req.url.startsWith("/api/chat")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "mock-ollama ok" }));
    return;
  }

  // Drain the request body (we don't actually need it, but must consume it).
  req.on("data", () => {});
  req.on("end", () => {
    const respond = () => {
      const body = JSON.stringify({
        model: "mock",
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: REPLY },
        done: true,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    };
    if (LATENCY_MS > 0) setTimeout(respond, LATENCY_MS);
    else respond();
  });
});

server.listen(PORT, () => {
  console.log(`mock-ollama listening on http://0.0.0.0:${PORT} (latency ${LATENCY_MS}ms)`);
});
