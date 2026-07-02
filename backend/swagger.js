// backend/swagger.js
//
// Builds the OpenAPI 3.0 contract for the some-ai backend with `swagger-jsdoc`.
//
// Two halves make up the final spec:
//   1. This file holds the BASE definition — info, servers, tags, and the
//      reusable `components` (schemas + responses). These are shared across many
//      routes, so they stay centralized.
//   2. Each ROUTE documents its own path in an `@openapi` JSDoc comment right
//      above the handler in index.js. swagger-jsdoc scans the files listed in
//      `apis`, parses those comments as YAML, and merges them into `paths`.
//
// The assembled spec is still served from index.js:
//   - Interactive Swagger UI at  GET /api/docs
//   - Raw JSON spec at           GET /api/docs.json
//
// Why JSDoc-on-routes? The docs for an endpoint live next to the code that
// implements it, so they're far more likely to be updated together (less drift).
// This replaces the earlier hand-written `paths` object (see README4 → README5).

const path = require("path");
const swaggerJSDoc = require("swagger-jsdoc");

// The base document. swagger-jsdoc fills in `paths` from the JSDoc annotations.
const definition = {
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
};

// Scan index.js for `@openapi` JSDoc blocks and merge their paths into the spec.
const openapiSpec = swaggerJSDoc({
  definition,
  apis: [path.join(__dirname, "index.js")],
});

module.exports = openapiSpec;
