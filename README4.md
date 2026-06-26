# Lab 4 — API Documentation with Swagger / OpenAPI

This is the fourth lab, after the main [README.md](README.md) (Redis + Ollama + Express),
[README2.md](README2.md) (Cypress E2E), and [README3.md](README3.md) (K6 load testing). So far
the only description of the API has been prose in the README. This lab gives the backend a
**machine-readable, interactive contract** using **[OpenAPI](https://www.openapis.org/)** and
**[Swagger UI](https://swagger.io/tools/swagger-ui/)**.

---

## Why document an API this way?

Prose docs drift and can't be executed. An **OpenAPI document** is a structured description of every
endpoint — its path, parameters, request body, responses, and status codes. Once you have it you get,
for free:

- **Swagger UI** — a browsable page where you can read every endpoint and hit **"Try it out"** live.
- **Tooling** — import the spec into Postman/Insomnia, generate client SDKs, or lint it in CI.
- **A single source of truth** the app, tests, and teammates can all point at.

```
                         GET /api/docs       ┌────────────────────┐
   Browser ────────────────────────────────▶ │  Swagger UI        │
                                              │  (rendered spec)   │
   Postman / codegen ──▶ GET /api/docs.json ─▶│  raw OpenAPI JSON  │
                                              └─────────┬──────────┘
                                                        │ describes
                                              ┌─────────▼──────────┐
                                              │  Express routes    │
                                              │  backend/index.js  │
                                              └────────────────────┘
```

---

## What we're building

We serve an OpenAPI **3.0.3** document with the `swagger-ui-express` package. The spec itself is a
plain **JavaScript object** in [backend/swagger.js](backend/swagger.js) — one file holding the whole
contract, kept separate from the route handlers.

> **Note — no JSDoc yet.** A common alternative is to scatter `@openapi` JSDoc comments above each
> route and auto-collect them with `swagger-jsdoc`. We're deliberately *not* doing that here. A
> **future lab** will refactor this hand-written spec into JSDoc annotations once we've covered JSDoc.

---

## Prerequisites

The base stack from [README.md](README.md). Docker Desktop running.

---

## Step 1 — Install the dependency and rebuild

`swagger-ui-express` was added to [backend/package.json](backend/package.json). Because the backend
runs in Docker, rebuild the image so the new dependency is installed:

```bash
docker compose up -d --build
```

Confirm the API came up — the logs now print the docs URL:

```bash
docker compose logs api | grep "API docs"
# API docs:      http://localhost:3001/api/docs
```

---

## Step 2 — Tour the spec file

Open [backend/swagger.js](backend/swagger.js). It has four parts:

| Section | What it holds |
|---------|---------------|
| `info` | Title, version, description, license. |
| `servers` | A **relative** url (`/`) — Swagger UI's "Try it out" then targets whatever host served the page, so it works on `localhost` **and** from a phone on your LAN IP. |
| `tags` | Groups the operations in the UI: **Health**, **Chat**, **Sessions**. |
| `components` | Reusable `schemas` (e.g. `Message`, `ChatRequest`, `Error`) and `responses` (`NotFound`, `ServerError`, `BadGateway`) that the paths `$ref` so shapes aren't repeated. |
| `paths` | Each route: parameters, request body, and **every** response code (200/404/500/502). |

This mirrors `backend/index.js` exactly. When you change a route, update this file too — keeping the
two in sync by hand is precisely the chore the next (JSDoc) lab removes.

---

## Step 3 — Open Swagger UI

Visit **[http://localhost:3001/api/docs](http://localhost:3001/api/docs)**.

You'll see the three tag groups. Expand an endpoint to read its schema and examples, then click
**"Try it out" → "Execute"** to call the live API from the browser:

- **`GET /api/health`** and **`GET /api/sessions`** — instant, safe to run.
- **`GET /api/sessions/{sessionId}`** — paste an id from the sessions list.
- **`DELETE /api/sessions/{sessionId}`** — removes a session (verify it's gone in RedisInsight).
- **`POST /api/chat`** — works, but it calls a **real model**, so it can take several seconds.

> **Tip:** To explore `POST /api/chat` with instant responses, bring up the **mock-Ollama benchmark
> stack** from [README3.md](README3.md):
> `docker compose -f docker-compose.yml -f docker-compose.k6.yml up -d --build`. The chat endpoint
> then returns a canned reply immediately — handy while clicking around the docs.

---

## Step 4 — The raw spec

The same document is available as JSON at
**[http://localhost:3001/api/docs.json](http://localhost:3001/api/docs.json)**:

```bash
curl -s http://localhost:3001/api/docs.json | head
```

Use it to:
- **Import into Postman / Insomnia** (File → Import → URL) to get a ready-made request collection.
- **Generate a client SDK** with `openapi-generator`.
- **Lint the contract** in CI: `npx @redocly/cli lint http://localhost:3001/api/docs.json`.

---

## Best practices recap

- **One source of truth** — the whole contract is in `backend/swagger.js`.
- **DRY** — shared shapes live in `components` and are `$ref`'d, not copy-pasted per route.
- **Document failure, not just success** — every route lists its 4xx/5xx responses.
- **Relative server url** — `"/"` makes "Try it out" work from any host without editing the spec.
- **Version the contract** — bump `info.version` when the API changes.

## What's next

- **JSDoc-generated spec** — move these definitions into `@openapi` comments on each route and let
  `swagger-jsdoc` assemble them (the announced next lab).
- **Request validation** — feed this same spec to `express-openapi-validator` so malformed requests
  are rejected with a 400, making the docs *enforce* the contract.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `/api/docs` returns 404 / "Cannot GET" | The image wasn't rebuilt after adding the dependency. Run `docker compose up -d --build`. |
| `Cannot find module 'swagger-ui-express'` in logs | Same cause — rebuild so `npm install` runs inside the image. |
| "Try it out" on `POST /api/chat` hangs | It's calling a real model. Use the README3 mock stack for instant replies, or be patient. |
| "Failed to fetch" / CORS in "Try it out" | The relative `servers: "/"` url avoids this. If you hard-coded a host, make sure it matches the page's origin. |
| Docs load but show no endpoints | `backend/swagger.js` failed to load or `paths` is empty — check `docker compose logs api` for a parse error. |
