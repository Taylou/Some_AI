# Lab 5 — Co-locating API Docs with JSDoc (`swagger-jsdoc`)

In [Lab 4](README4.md) we documented the API with a single hand-written OpenAPI object in
`backend/swagger.js`. It worked, but it had one weakness: the docs for a route lived in a *different
file* from the route itself, so it was easy to change a handler and forget to update the spec.

This lab fixes that by moving each route's documentation **directly above its handler** as a JSDoc
comment, and letting **[`swagger-jsdoc`](https://github.com/Surnet/swagger-jsdoc)** assemble the
full spec at startup. The rendered Swagger UI is **identical** — only the *source* of the `paths`
changed.

---

## The idea

`swagger-jsdoc` builds an OpenAPI document from two inputs:

1. A **base definition** — everything that isn't a path: `info`, `servers`, `tags`, and the reusable
   `components` (schemas + responses). Shared by many routes, so it stays centralized in
   `backend/swagger.js`.
2. A list of **source files to scan** (`apis`). `swagger-jsdoc` reads those files, finds every
   comment tagged `@openapi`, parses the YAML inside, and merges it into `paths`.

```
 backend/swagger.js                     backend/index.js
 ┌───────────────────────┐              ┌──────────────────────────────┐
 │ definition:           │              │ /** @openapi                 │
 │   info / servers      │   apis: [    │  * /api/health:              │
 │   tags                │   index.js   │  *   get: { ... }            │
 │   components:         │   ]  ───────▶│  */                          │
 │     schemas           │              │ app.get('/api/health', ...)  │
 │     responses         │              │                              │
 └──────────┬────────────┘              │ (one @openapi block per route)│
            │                           └───────────────┬──────────────┘
            │        swaggerJSDoc({ definition, apis })  │
            └───────────────────────┬────────────────────┘
                                     ▼
                     assembled OpenAPI spec  →  GET /api/docs
```

`backend/swagger.js` now ends with:

```js
const openapiSpec = swaggerJSDoc({
  definition,                                  // info, servers, tags, components
  apis: [path.join(__dirname, "index.js")],    // files to scan for @openapi blocks
});
module.exports = openapiSpec;
```

`index.js` still does `const openapiSpec = require("./swagger")` and serves it exactly as before —
nothing about `/api/docs` or `/api/docs.json` changed.

---

## Anatomy of an `@openapi` block

Here's the health route. The comment is **YAML** (indentation matters!), and the `@openapi` tag is
what `swagger-jsdoc` looks for:

```js
/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Health]
 *     operationId: getHealth
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Service is up.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HealthResponse' }
 */
app.get("/api/health", (req, res) => { ... });
```

Two things to notice:

- The block only describes the **path** (`/api/health` → `get`). The response *shape*
  (`HealthResponse`) is `$ref`'d from the shared `components` in `swagger.js` — we don't redefine
  schemas per route.
- Routes that share a URL just document their own verb. `GET` and `DELETE /api/sessions/{sessionId}`
  live in two separate blocks; `swagger-jsdoc` merges them under one path.

---

## Step 1 — Rebuild

A new dependency (`swagger-jsdoc`) was added to [backend/package.json](backend/package.json), so
rebuild the image:

```bash
docker compose up -d --build
```

## Step 2 — Read the annotations

Open [backend/index.js](backend/index.js) and look above each `app.get/post/delete`. Every route now
carries its own `@openapi` block. Compare with the centralized `components` in
[backend/swagger.js](backend/swagger.js) that they reference.

## Step 3 — Confirm nothing regressed

The docs should look exactly as they did in Lab 4:

```bash
curl -s http://localhost:3001/api/docs.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log('paths:',Object.keys(s.paths));})"
```

Then open **[http://localhost:3001/api/docs](http://localhost:3001/api/docs)** — same five operations,
now sourced from the route comments.

> **Try it:** add a new field to a schema in `swagger.js`, or a `description` to a route's `@openapi`
> block, rebuild, and refresh the docs to see your change flow through.

---

## Gotchas

| Symptom | Cause / fix |
|---------|-------------|
| A route is **missing** from the docs | Its `@openapi` YAML has an indentation error, so `swagger-jsdoc` skipped the block. YAML is whitespace-sensitive — align keys carefully. |
| Nothing shows up at all | The `apis` glob in `swagger.js` doesn't point at the file with the comments. It must include `index.js` (or wherever your routes live). |
| Changes don't appear | The image wasn't rebuilt (`docker compose up -d --build`). The spec is assembled when the server starts. |
| `$ref` shows as unresolved in the UI | The referenced name doesn't exist under `components` in `swagger.js`, or the path is misspelled (`#/components/schemas/Xyz`). |

## Best practices recap

- **Path docs next to the code**, shared shapes centralized — the split that keeps docs honest.
- **`$ref` everything reusable** so a schema is defined once.
- Keep the `apis` list tight and intentional; as the app grows, split routes into modules and list
  each (e.g. `apis: ["index.js", "routes/*.js"]`).

## What's next

- **Request validation** — feed this same spec to `express-openapi-validator` so malformed requests
  are rejected with a 400, turning the documentation into an enforced contract.
