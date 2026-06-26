// backend/swagger.js
//
// The OpenAPI 3.0 contract for the some-ai backend, written as a plain JS object.
//
// Why a hand-written object (and not JSDoc annotations)? It keeps the WHOLE API
// contract in one readable file — a single source of truth, decoupled from the
// route handlers — without introducing JSDoc syntax yet. A later lab refactors
// this into JSDoc comments auto-collected by `swagger-jsdoc`.
//
// This object is served two ways from index.js:
//   - Interactive Swagger UI at  GET /api/docs
//   - Raw JSON spec at           GET /api/docs.json
//
// Best practices used here:
//   - Reusable components.schemas / components.responses ($ref'd, so we don't
//     repeat the same shapes on every route).
//   - Every status code a route can return is documented (200/404/500/502).
//   - A RELATIVE server url ("/") so Swagger UI's "Try it out" targets whatever
//     host served the page — works from localhost AND a phone on your LAN IP.

const openapiSpec = {
  openapi: "3.0.3",

  info: {
    title: "some-ai Backend API",
    version: "1.0.0",
    description:
      "Express API that bridges the React Native app to Ollama and persists " +
      "chat conversations in Redis. See README.md for the full architecture.",
    license: { name: "0BSD" },
  },

  // Relative URL: Swagger UI resolves it against the origin that served the docs,
  // so the same spec works on http://localhost:3001 and http://<LAN-IP>:3001.
  servers: [{ url: "/", description: "This API server" }],

  tags: [
    { name: "Health", description: "Service liveness" },
    { name: "Chat", description: "Send messages to the model (proxied to Ollama)" },
    { name: "Sessions", description: "Browse and manage stored conversations" },
  ],

  components: {
    schemas: {
      // A message as the CLIENT sends it (what the app posts to /api/chat).
      MessageInput: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: {
            type: "string",
            enum: ["user", "assistant", "system"],
            example: "user",
          },
          content: { type: "string", example: "Hello! What is Redis?" },
          images: {
            type: "array",
            description: "Optional base64-encoded images for vision models.",
            items: { type: "string" },
          },
        },
      },

      // A message as it is STORED and returned (adds a server timestamp).
      Message: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["user", "assistant"], example: "assistant" },
          content: { type: "string", example: "Redis is an in-memory data store." },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-06-25T12:34:56.789Z",
          },
        },
      },

      ChatRequest: {
        type: "object",
        required: ["messages"],
        properties: {
          sessionId: {
            type: "string",
            description: "Omit to start a new session; pass to continue one.",
            example: "a1b2c3d4-0000-0000-0000-000000000000",
          },
          model: {
            type: "string",
            description: "Ollama model tag.",
            default: "deepseek-r1:1.5b",
            example: "deepseek-r1:1.5b",
          },
          systemPrompt: {
            type: "string",
            description: "Optional system message prepended before the messages.",
            example: "You are a helpful assistant.",
          },
          messages: {
            type: "array",
            items: { $ref: "#/components/schemas/MessageInput" },
          },
        },
      },

      ChatResponse: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            example: "a1b2c3d4-0000-0000-0000-000000000000",
          },
          reply: {
            type: "string",
            example: "Redis is an in-memory data structure store...",
          },
        },
      },

      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          redis: {
            type: "string",
            description: "ioredis connection status.",
            example: "ready",
          },
          ollama: {
            type: "string",
            description: "Configured Ollama base URL.",
            example: "http://host.docker.internal:11434",
          },
        },
      },

      SessionList: {
        type: "object",
        properties: {
          sessions: {
            type: "array",
            items: { type: "string" },
            example: ["a1b2c3d4-0000-0000-0000-000000000000"],
          },
        },
      },

      SessionHistory: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            example: "a1b2c3d4-0000-0000-0000-000000000000",
          },
          messages: {
            type: "array",
            items: { $ref: "#/components/schemas/Message" },
          },
        },
      },

      DeleteResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          sessionId: {
            type: "string",
            example: "a1b2c3d4-0000-0000-0000-000000000000",
          },
        },
      },

      Error: {
        type: "object",
        properties: {
          error: { type: "string", example: "Session not found" },
        },
      },
    },

    // Reusable responses for the error cases shared across routes.
    responses: {
      NotFound: {
        description: "The session does not exist.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "Session not found" },
          },
        },
      },
      ServerError: {
        description: "Unexpected server / Redis error.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "Internal server error" },
          },
        },
      },
      BadGateway: {
        description: "Upstream Ollama returned an error.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "Ollama error: model not found" },
          },
        },
      },
    },
  },

  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Health check",
        description: "Confirms the server is reachable and reports Redis/Ollama status.",
        responses: {
          200: {
            description: "Service is up.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },

    "/api/chat": {
      post: {
        tags: ["Chat"],
        operationId: "postChat",
        summary: "Send a chat message",
        description:
          "Forwards the conversation to Ollama, persists the last user message " +
          "and the assistant reply to Redis, and returns the reply plus the " +
          "session id. Omit `sessionId` to start a new conversation.\n\n" +
          "Note: this calls a real model, so it can take several seconds. To " +
          "explore the docs quickly, run the mock-Ollama benchmark stack from README3.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatRequest" },
              example: {
                model: "deepseek-r1:1.5b",
                messages: [{ role: "user", content: "Hello! What is Redis?" }],
              },
            },
          },
        },
        responses: {
          200: {
            description: "The assistant reply and the session id.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatResponse" },
              },
            },
          },
          502: { $ref: "#/components/responses/BadGateway" },
          500: { $ref: "#/components/responses/ServerError" },
        },
      },
    },

    "/api/sessions": {
      get: {
        tags: ["Sessions"],
        operationId: "listSessions",
        summary: "List all session ids",
        description: "Returns every session id stored in the Redis `sessions` SET.",
        responses: {
          200: {
            description: "Array of session ids.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionList" },
              },
            },
          },
          500: { $ref: "#/components/responses/ServerError" },
        },
      },
    },

    "/api/sessions/{sessionId}": {
      parameters: [
        {
          name: "sessionId",
          in: "path",
          required: true,
          description: "The session id (UUID returned by /api/chat).",
          schema: { type: "string" },
        },
      ],
      get: {
        tags: ["Sessions"],
        operationId: "getSession",
        summary: "Get a session's history",
        description: "Returns every stored message for the session, in order.",
        responses: {
          200: {
            description: "The full chat history.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionHistory" },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
          500: { $ref: "#/components/responses/ServerError" },
        },
      },
      delete: {
        tags: ["Sessions"],
        operationId: "deleteSession",
        summary: "Delete a session",
        description: "Removes the session's message list and its id from the index.",
        responses: {
          200: {
            description: "The session was deleted.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeleteResponse" },
              },
            },
          },
          404: { $ref: "#/components/responses/NotFound" },
          500: { $ref: "#/components/responses/ServerError" },
        },
      },
    },
  },
};

module.exports = openapiSpec;
