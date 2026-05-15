// ai/ollamaClient.js

export class OllamaClient {
  constructor({ baseUrl = "http://10.2.228.127:11434" } = {}) {
    this.baseUrl = baseUrl;
  }

  async generate({
    model,
    prompt,
    system,
    temperature = 0.7,
    stream = false,
  }) {
    const response = await fetch(`${this.baseUrl}/api/genarate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system,
        temperature,
        stream,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    return response.json();
  }

  async chat({
    model,
    messages,
    temperature = 0.7,
    stream = false,
  }) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    return response.json();
  }
}
