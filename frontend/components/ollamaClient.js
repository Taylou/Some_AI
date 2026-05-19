// frontend/components/ollamaClient.js
//
// Client for the some-ai Express backend (NOT Ollama directly).
//
//   App  ─▶  Express API (port 3001)  ─▶  Ollama (port 11434)
//                       │
//                       ▼
//                     Redis
//
// The backend handles:
//   - proxying chat requests to Ollama
//   - persisting conversations in Redis (keyed by sessionId)
//   - returning the assistant reply + the sessionId to reuse
//
// IMPORTANT: change `baseUrl` to your host machine's LAN IP — the IP
// of the laptop running `docker compose up`. "localhost" will NOT work
// from a phone running Expo Go.

export class OllamaClient {
  constructor({ baseUrl = "http://172.24.208.1:3001" } = {}) {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a chat request to the backend.
   *
   * @param {Object}   args
   * @param {string}   args.model         e.g. "deepseek-r1:1.5b"
   * @param {Array}    args.messages      [{ role, content, images? }]
   * @param {string?}  args.sessionId     pass null/undefined to start a new session
   * @param {string?}  args.systemPrompt  prepended by the backend as a system message
   * @returns {Promise<{ sessionId: string, reply: string }>}
   */
  async chat({ model, messages, sessionId, systemPrompt }) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, sessionId, systemPrompt }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Backend error ${response.status}: ${text || response.statusText}`);
    }

    return response.json(); // { sessionId, reply }
  }
}
