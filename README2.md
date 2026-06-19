# Testing Guide (Cypress)

This is the companion to the main [README.md](README.md). It covers the
**automated tests** for the project. Right now the suite is **end-to-end (E2E)**
only — driving the app's web build in a real browser. Component testing is
planned for the next session (see [Roadmap](#roadmap)).

---

## What we test and how

The Expo app runs on the web via `react-native-web` (`npm run web`). Cypress
loads that web build in a headless (or headed) browser and exercises the real UI:
typing a message, switching models, clearing the chat, and so on.

To keep the E2E tests **fast and deterministic**, we **stub the backend** with
`cy.intercept()` instead of hitting the live Express API. That means you do **not**
need Docker, Redis, or Ollama running to execute the test suite — only the Expo
web server. (There is a note below on running against the real backend if you
want a true full-stack check.)

```
┌──────────────┐     drives      ┌────────────────────┐
│   Cypress    │ ──────────────▶ │  Expo web build    │
│  (browser)   │                 │  localhost:8081    │
└──────────────┘                 └─────────┬──────────┘
       │  cy.intercept() stubs             │ fetch()
       └───────────────────────────────────┘
              POST /api/chat → fake reply
              DELETE /api/sessions/:id → { success: true }
```

---

## Layout

```
frontend/
├── cypress.config.js          ← base URL, timeouts, spec pattern
└── cypress/
    ├── support/
    │   ├── e2e.js             ← loaded before every spec
    │   └── commands.js        ← custom commands (byTestId, stubChat)
    └── e2e/
        ├── app_smoke.cy.js    ← app loads, header + model selector work
        ├── chat_flow.cy.js    ← send a message, see the (stubbed) reply
        └── clear_chat.cy.js   ← Clear button wipes UI + calls DELETE
```

### `testID` → `data-testid`

`react-native-web` renders a component's `testID` prop as a `data-testid` DOM
attribute. The UI exposes these stable hooks for the tests:

| `testID`            | Element                    |
|---------------------|----------------------------|
| `message-input`     | the chat text input        |
| `send-button`       | the Send button            |
| `model-button`      | the model selector button  |
| `clear-chat-button` | the Clear button           |

The custom command `cy.byTestId("send-button")` is shorthand for
`cy.get('[data-testid="send-button"]')`.

---

## Prerequisites

| Tool    | Version | Purpose                              |
|---------|---------|--------------------------------------|
| Node.js | 18 or 20 | Runs Expo + Cypress                 |
| Chrome / Electron | bundled | Cypress runs in a browser  |

Install the dev dependencies (Cypress + helper) inside `frontend/`:

```bash
cd frontend
npm install
```

> The first `cypress run`/`open` downloads the Cypress binary (~few hundred MB).
> This is a one-time download cached outside the repo.

---

## Running the tests

### Option A — let the script start the server for you (recommended)

`start-server-and-test` boots the Expo web server, waits for
`http://localhost:8081`, runs Cypress headless, then shuts the server down:

```bash
cd frontend
npm run test:e2e
```

### Option B — run the server and Cypress separately

Terminal 1:

```bash
cd frontend
npm run web          # serves the app on http://localhost:8081
```

Terminal 2:

```bash
cd frontend
npm run cypress:open   # interactive runner (pick a spec, watch it run)
# or
npm run cypress:run    # headless, all specs
```

> **First load is slow.** Expo compiles the web bundle on the first request, so
> the initial `cy.visit("/")` can take a while. The config already raises
> `pageLoadTimeout` to 120s to absorb this.

---

## Writing a new E2E test

1. Add a `*.cy.js` file under `frontend/cypress/e2e/`.
2. Add a `testID` to any new UI element you need to target, then select it with
   `cy.byTestId(...)`.
3. Stub any backend call the flow makes so the test stays deterministic:

```js
describe("My feature", () => {
  beforeEach(() => {
    cy.stubChat("A canned assistant reply.");  // stubs POST /api/chat
    cy.visit("/");
  });

  it("does the thing", () => {
    cy.byTestId("message-input").type("hello");
    cy.byTestId("send-button").click();
    cy.wait("@chat");
    cy.contains("A canned assistant reply.").should("be.visible");
  });
});
```

---

## Running against the real backend (optional full-stack check)

The stubbed suite verifies the **frontend** behavior. To exercise the whole
stack instead:

1. Start the backend stack: `docker compose up --build -d` (from the repo root).
2. Make sure Ollama is reachable (see the main README).
3. In a spec, **omit** `cy.stubChat()` so requests hit the real API. Note these
   runs are slower and depend on the model's actual output, so assert loosely
   (e.g. that *some* assistant bubble appears) rather than on exact text.

---

## Roadmap

- [x] **E2E tests** — app smoke, chat flow, clear chat (this session)
- [x] **Load / benchmark tests** — K6, see [README3.md](README3.md) (Lab 3)
- [ ] **Component tests** — mount `ChatView`, `OllamaClient`, and `AIService` in
  isolation with Cypress Component Testing (next session)
- [ ] Wire `npm run test:e2e` into CI

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `cy.visit` times out | The Expo web server isn't up yet. Run `npm run web` and wait for "Web is waiting on http://localhost:8081", or use `npm run test:e2e`. |
| Tests can't find an element | Confirm the element has a `testID` and that `react-native-web` rendered it as `data-testid` (inspect the DOM). |
| Port 8081 in use | Stop the other process, or set `CYPRESS_BASE_URL` to the port Expo actually chose. |
| Cypress binary download fails | Re-run `npx cypress install`, or set `CYPRESS_INSTALL_BINARY` / a proxy if you're behind a firewall. |
| Real-backend test is flaky | Model output varies — assert on UI structure (a bubble appears), not exact wording. |
