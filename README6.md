# Lab 6 — Continuous Integration with GitHub Actions

The last four labs each added a piece of quality tooling: Cypress end-to-end tests ([Lab 2](README2.md)),
K6 load tests ([Lab 3](README3.md)), and self-documenting API docs ([Lab 4](README4.md) / [Lab 5](README5.md)).
They all have one thing in common — **someone has to remember to run them.** Nothing stops a broken
commit from landing on `main`.

This lab closes that gap with **Continuous Integration (CI)**: a [GitHub Actions](https://docs.github.com/actions)
pipeline that runs the whole suite automatically on every push and every pull request. If a test
fails, the run goes red and you find out in minutes — not when a classmate pulls your code.

Nothing new is installed. The pipeline is just an *orchestrator* that drives the tools you already
built, on a fresh cloud machine, from a clean checkout.

---

## The idea

A GitHub Actions **workflow** is a YAML file in `.github/workflows/`. GitHub watches your repo and,
whenever a trigger fires (a push, a PR), spins up disposable Linux **runners** and executes the
**jobs** you defined. Jobs run **in parallel** by default, each on its own machine.

Our workflow lives in [.github/workflows/ci.yml](.github/workflows/ci.yml) and defines four jobs:

```
 push / pull_request
         │
         ├──▶ lint          node --check on the CommonJS server files
         │
         ├──▶ e2e           npm run test:e2e   (Expo web + Cypress)      ← Lab 2
         │
         ├──▶ api-k6        docker compose up  +  K6 smoke test          ← Lab 3
         │
         └──▶ docker-build  build backend + mock-ollama images
                                   │
                              all green ✔  →  safe to merge
```

Because the jobs are independent, a Cypress failure and a K6 failure surface at the same time instead
of one hiding behind the other.

---

## Trigger model

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

- **Push to `main`** — validates whatever just landed on the trunk.
- **Pull request** — validates the *proposed* change before it merges. This is where CI earns its
  keep: you see green/red right on the PR.

Two more top-level settings keep it tidy:

- `concurrency: cancel-in-progress: true` — if you push twice quickly, the older run is cancelled so
  you're not paying for stale work.
- `permissions: contents: read` — the workflow's token can only *read* the code. Least privilege.

---

## The four jobs

### 1. `lint` — a syntax gate

`node --check` parses a file and reports syntax errors **without running it**. It's a fast, zero-dependency
smoke alarm. It only understands CommonJS, so we point it at the server files:

```bash
node --check backend/index.js
node --check backend/swagger.js
node --check mock-ollama/server.js
```

> The frontend is **JSX** and the k6 scripts are **ES modules** — `node --check` can't parse either.
> That's fine: they get compiled/executed for real by the `e2e` and `api-k6` jobs, which would fail on
> a syntax error anyway. (Adding ESLint here is the natural next lab.)

### 2. `e2e` — the Cypress suite

This job runs the **exact command you run locally** — no CI-special variant to drift out of sync:

```bash
npm run test:e2e     # start-server-and-test web http://localhost:8081 cypress:run
```

`start-server-and-test` boots Expo web, waits for `:8081` to answer, runs `cypress run` against it,
then shuts the server down. Cypress uses its **bundled Electron** browser, so nothing extra is
installed. The specs stub the backend with `cy.intercept()` (see [Lab 2](README2.md)), so this job
needs **no API and no Redis**. On failure it uploads the Cypress screenshots as an artifact.

### 3. `api-k6` — the real stack under load

This is the integration gate. It stands up the actual backend and runs a benchmark against it:

```bash
# 1. Bring up Redis + API + the deterministic mock-ollama (Lab 3's override).
docker compose -p some-ai -f docker-compose.yml -f docker-compose.k6.yml up -d --build

# 2. Poll until the API answers.
curl -fsS http://localhost:3001/api/health

# 3. Run the smoke test on the compose network.
docker run --rm --network some-ai_default -e BASE_URL=http://api:3001 \
  -v "$PWD/k6:/scripts" grafana/k6 run /scripts/01-smoke.js
```

Two details make this reliable in CI:

- **`-p some-ai`** pins the compose *project name*, so the network is always `some-ai_default` — the
  name the `k6` container connects to. Without it, the network name would depend on the checkout
  folder.
- **`mock-ollama`** replaces the real LLM, so responses are instant and deterministic. CI measures the
  *app's* behaviour, not a model's mood.

The smoke test ([k6/01-smoke.js](k6/01-smoke.js)) carries **thresholds** — `<1%` request failures and
`>99%` checks passing. K6 exits non-zero when a threshold is breached, so a broken session endpoint
turns the whole job red. The run always tears down with `down -v` and uploads its JSON summary.

### 4. `docker-build` — the images still build

A quick guard that both Dockerfiles build from a clean context:

```bash
docker build -t some-ai-backend:ci     ./backend
docker build -t some-ai-mock-ollama:ci ./mock-ollama
```

No registry push — this lab stays local/CI-only. It just catches the classic "works on my machine but
the Dockerfile is broken" regression.

---

## Seeing it run

CI activates the moment the workflow file is on GitHub:

1. Commit and push:
   ```bash
   git add .github/workflows/ci.yml README6.md .env.example README.md
   git commit -m "Add CI pipeline (Lab 6)"
   git push
   ```
2. Open your repo on GitHub → the **Actions** tab. You'll see the run, with the four jobs streaming
   their logs live.
3. Open a pull request against `main` and watch the checks appear at the bottom of the PR.

The **badge** at the top of [README.md](README.md) reflects the latest run on `main` — green when the
build passes, red when it doesn't.

---

## Reproducing a job locally

Every job is just shell commands, so you can run any of them on your own machine before pushing:

| Job | Local command |
|-----|---------------|
| `lint` | `node --check backend/index.js backend/swagger.js mock-ollama/server.js` |
| `e2e` | `cd frontend && npm ci && npm run test:e2e` |
| `api-k6` | `docker compose -p some-ai -f docker-compose.yml -f docker-compose.k6.yml up -d --build` then the `grafana/k6 run … 01-smoke.js` command above |
| `docker-build` | `docker build ./backend && docker build ./mock-ollama` |

Want to run the **entire workflow** locally? Install [`act`](https://github.com/nektos/act) and run
`act pull_request` — it executes the jobs in Docker containers that mirror the GitHub runners.

---

## Gotchas

| Symptom | Cause / fix |
|---------|-------------|
| `api-k6` can't find network `some-ai_default` | The compose project name wasn't pinned. Every compose command in the job must include `-p some-ai`. |
| K6 job fails on thresholds | A session endpoint regressed (or the mock changed shape). Read the K6 summary — the failing `check` names the exact request. |
| `npm ci` fails with a lockfile error | `package-lock.json` is out of sync with `package.json`. Run `npm install` locally and commit the updated lockfile. |
| Cypress hangs then times out | Expo web didn't come up. Check the `start-server-and-test` output at the top of the `e2e` log. |
| The badge shows "no status" | The workflow hasn't run on `main` yet, or the badge URL's owner/repo doesn't match. Push once to `main`. |
| K6 module "not found" when running the local repro on **Windows Git Bash** | Git Bash rewrites `/scripts/01-smoke.js` into a Windows path. Prefix the command with `MSYS_NO_PATHCONV=1` (or run it from PowerShell/WSL). This only affects local runs — the Linux CI runner is unaffected. |

## What's next

- **Lint for real** — add ESLint + Prettier and a Husky pre-commit hook, then let the `lint` job
  enforce style, not just syntax.
- **Security scanning** — an `npm audit` step and a [Trivy](https://github.com/aquasecurity/trivy)
  scan of the built images.
- **Continuous *Deployment*** — once CI is green, a `deploy` job could push the image to a registry
  and ship it to a host (Fly.io, Render, …). That's the "CD" half, and a lab of its own.
