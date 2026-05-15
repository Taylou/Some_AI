// ai/aiService.js
import { OllamaClient } from "./ollamaClient";

export class AIService {
  constructor({
    model = "deepseek-r1:1.5b",
    systemPrompt = "You are a helpful assistant.",
    temperature = 0.7,
    baseUrl,
  } = {}) {
    console.log(model);
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.temperature = temperature;
    this.client = new OllamaClient({ baseUrl });
  }

  async ask(prompt) {
    const response = await this.client.generate({
      model: this.model,
      prompt,
      system: this.systemPrompt,
      temperature: this.temperature,
    });

    return response.response;
  }

  /**
   * chat(messages)
   *
   * Each message may carry an optional `attachments` array produced by ChatView:
   *   { type: "image" | "file", base64: string, mimeType: string, name: string }
   *
   * Images are forwarded to Ollama's vision API as base64 strings.
   * Non-image files have their content appended as text in the message body.
   */
  async chat(messages) {
    const ollamaMessages = [
      { role: "system", content: this.systemPrompt },
      ...messages.map((msg) => this._toOllamaMessage(msg)),
    ];

    const response = await this.client.chat({
      model: this.model,
      messages: ollamaMessages,
      temperature: this.temperature,
    });

    return response.message?.content;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Convert a ChatView message (with optional attachments) into the shape
   * Ollama expects:
   *   { role, content, images? }
   *
   * Ollama vision models accept `images` as an array of raw base64 strings
   * (no data-URI prefix).
   *
   * For non-image files we append the decoded text to the message content
   * so text-based models can still reason about it.
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

  /** Decode a base64 string to UTF-8 text (works for plain text / PDFs / CSVs). */
  _decodeBase64Text(base64) {
    // React Native global atob, or fallback
    const binary = typeof atob === "function"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("binary");

    // Convert binary string to UTF-8
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
