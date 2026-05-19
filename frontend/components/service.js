// frontend/components/service.js
//
// Thin wrapper around OllamaClient that:
//   - tracks the active sessionId across messages
//   - converts ChatView attachments into the shape the backend forwards to Ollama
//   - returns just the reply string to ChatView
//
import { OllamaClient } from "./ollamaClient";

export class AIService {
  constructor({
    model = "deepseek-r1:1.5b",
    systemPrompt = "You are a helpful assistant.",
    temperature = 0.7,
    baseUrl,
  } = {}) {
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.temperature = temperature;
    this.client = new OllamaClient({ baseUrl });
    this.sessionId = null; // assigned by the backend on first request
  }

  /**
   * Send the chat history to the backend and return the assistant reply.
   *
   * The backend handles persistence in Redis — we just forward the
   * messages, the model, the system prompt, and any known sessionId.
   *
   * @param {Array} messages [{ role, content, attachments? }]
   * @returns {Promise<string>} the assistant reply
   */
  async chat(messages) {
    const backendMessages = messages.map((msg) => this._toOllamaMessage(msg));

    const { sessionId, reply } = await this.client.chat({
      model: this.model,
      messages: backendMessages,
      sessionId: this.sessionId,
      systemPrompt: this.systemPrompt,
    });

    // Remember the sessionId so the next message lands in the same Redis list
    this.sessionId = sessionId;
    return reply;
  }

  /** Convenience: single-prompt send. Routes through chat() so it still persists. */
  async ask(prompt) {
    return this.chat([{ role: "user", content: prompt }]);
  }

  /** Forget the current session — the next message will start a fresh one. */
  resetSession() {
    this.sessionId = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Convert a ChatView message (with optional attachments) into the shape
   * Ollama expects:  { role, content, images? }
   *
   * The backend forwards messages to Ollama as-is, so the conversion
   * happens here in the frontend.
   *
   * - Images become an array of raw base64 strings on `images`
   *   (Ollama's vision field — works with LLaVA, etc.)
   * - Non-image files have their decoded text appended to `content`
   */
  _toOllamaMessage(msg) {
    const { role, content, attachments } = msg;

    if (!attachments || attachments.length === 0) {
      return { role, content };
    }

    const imageBase64List = [];
    const textChunks = content ? [content] : [];

    for (const attachment of attachments) {
      if (attachment.type === "image") {
        // Strip data-URI prefix if present ("data:image/jpeg;base64,...")
        const raw = attachment.base64.replace(/^data:[^;]+;base64,/, "");
        imageBase64List.push(raw);
      } else {
        // For text-based files, try to decode and append inline
        try {
          const decoded = this._decodeBase64Text(attachment.base64);
          textChunks.push(`\n\n--- attached file: ${attachment.name} ---\n${decoded}`);
        } catch {
          textChunks.push(`\n\n[Attached file: ${attachment.name} — binary content not shown]`);
        }
      }
    }

    const ollamaMsg = { role, content: textChunks.join("") };
    if (imageBase64List.length > 0) {
      ollamaMsg.images = imageBase64List; // Ollama vision field
    }
    return ollamaMsg;
  }

  /** Decode a base64 string to UTF-8 text (works for plain text / CSVs). */
  _decodeBase64Text(base64) {
    const binary = typeof atob === "function"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("binary");

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  setModel(model) {
    this.model = model;
  }

  setSystemPrompt(systemPrompt) {
    this.systemPrompt = systemPrompt;
  }
}
