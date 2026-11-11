# Crash Test: learning guide

This guide explains the project as it is built, one milestone at a time. It is written for someone who has used TypeScript, Node and React through vibecoding and wants to understand how a real codebase fits together.

Read the sections in order the first time. Each section points at real files, so open them while you read. The self-check questions in section 6 have answers hidden under each question. Try to answer first.

Sources: `PRD.md` (what and why), `ARCHITECTURE.md` (how), `AGENTS.md` (rules for the coding agent), and the code that exists today.

---

## 1. What Crash Test is

Crash Test tests AI shopping agents. It pretends to be a merchant, hands an agent a shopping task, and checks what actually happened to the money in PayPal's sandbox.

The main path:

```
  Agent under test          Shop (fake merchant)        Rail                 PayPal sandbox
  (an LLM with tools)  --->  REST API, policy-blind --->  one place that --->  Orders, captures,
        ^                    records every event         talks to PayPal      refunds (real
        |                                                                      sandbox money)
        |                                                                           |
        |                    Auditor  <-------- reads ground truth back ------------+
        |                       |
        |                       v
        |                 assertions (plain code)  -->  verdict and Trust Score
        |
   LLM roles that never decide pass or fail:
     - adversary: writes adversarial text (variants)
     - agent under test: the thing being tested
     - explainer: writes a readable explanation of a failure
```

The key idea is in the diagram. The agent says "I bought it, it cost $9.99". Crash Test does not believe that. It asks PayPal what was captured and refunded, then compares that with the rules. Money is ground truth.

### The rules in AGENTS.md and why each exists

| Rule                                  | Why it exists                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sandbox only                       | A bug or typo must never move real money. The sandbox host is a constant, and a check script (`check:sandbox-only`, planned, not written yet) will grep for the live host. |
| 2. Money is integers                  | Floats cannot represent cents exactly. `0.1 + 0.2` is `0.30000000000000004` in JavaScript.                                                                                 |
| 3. Ground truth from PayPal reads     | Our own database can be wrong or incomplete. PayPal's record is the thing being audited.                                                                                   |
| 4. LLMs never decide verdicts         | Model output is random and sometimes wrong. Pass or fail must be reproducible code. Every LLM output is also validated before use.                                         |
| 5. The Shop is policy-blind           | If the merchant knew the test rules, the test would not show how an agent behaves in the real world.                                                                       |
| 6. No secrets in the repo             | Keys in git leak. Payer emails are masked so no real personal data is stored.                                                                                              |
| 7. Determinism                        | A verdict must be re-computable later from the stored events. Otherwise a result cannot be trusted or debugged.                                                            |
| 8. TypeScript strict, no `any`        | `any` turns off the compiler's checks exactly where bugs hide. `unknown` plus zod forces a check.                                                                          |
| 9. Test first for pure logic          | Money, verdicts and guards are where a silent error costs the most, so they get tests first.                                                                               |
| 10. Do not invent PayPal API details  | An invented field name looks right and fails only in the sandbox. Trust live behavior and write it down.                                                                   |
| 11. Untrusted text is data            | Scenario text and agent transcripts can contain attacks. They must be shown as plain text, never run.                                                                      |
| 12. MIT license from the first commit | Without a license file nobody has permission to use the code, even if it is public.                                                                                        |

---

## 2. Architecture map

### 2.1 The planned components

From `ARCHITECTURE.md` section 2. Most of these do not exist yet. They are planned for later milestones.

```
  Browser (web UI)
     |  REST + SSE (live updates)
     v
  Node service (one process, Fastify)
  +-----------------------------------------------------------+
  |  API routes  ->  Run orchestrator  ->  Agent runtime      |
  |                                          |                |
  |                                          v                |
  |                                         Shop  -> Rail -> PayPal sandbox
  |                                                    ^      |
  |  Auditor (ledger, assertions, scoring) ------------+      |
  |     |                                                     |
  |     v                                                     |
  |  Judge LLM (explains failures)     SQLite (events, runs)  |
  +-----------------------------------------------------------+
```

What each one is for:

| Component        | Job                                                                                                 | Exists today                                      |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Web UI           | Shows runs, the results matrix, setup                                                               | Only a placeholder page (`apps/web/src/main.tsx`) |
| API routes       | Start runs, read results, stream events                                                             | Only `/healthz`                                   |
| Run orchestrator | Expands a suite into runs and schedules them                                                        | No                                                |
| Agent runtime    | Runs the LLM agent in a loop with guards                                                            | No                                                |
| Shop             | Fake merchant that the agent shops at                                                               | No                                                |
| Rail             | The one place that talks to PayPal. It has two versions: the real sandbox rail and a mock for tests | No (the spike scripts do the same calls by hand)  |
| Auditor          | Reads PayPal back and evaluates assertions                                                          | No                                                |
| Judge            | Writes an explanation for a failure                                                                 | No                                                |
| SQLite           | Stores events so every verdict can be recomputed                                                    | No                                                |

### 2.2 The life of one scenario run

From `ARCHITECTURE.md` section 2.1:

```
  Orchestrator        Agent           Shop             Rail              PayPal        Auditor
      |                 |               |                |                  |              |
      |-- create session -------------->|                |                  |              |
      |-- start ------->|               |                |                  |              |
      |                 |-- tool call ->|  (search, cart, quote, confirm)   |              |
      |                 |               |-- write event  |                  |              |
      |                 |               |-- charge ----->|-- write-ahead -->|              |
      |                 |               |                |-- POST order --->|              |
      |                 |               |                |<-- COMPLETED ----|              |
      |                 |<-- result ----|                |                  |              |
      |   ... loop until agent finishes or limits hit ...                                  |
      |-- audit ---------------------------------------------------------------------->|
      |                                                                       |-- GET order -->|
      |                                                                       |<-- truth ------|
      |                                                                       |-- assertions, verdict
```

Two things to notice. The Shop writes an event before and after each step, so the whole run can be replayed later. And the Auditor makes its own GET calls to PayPal. It does not trust what the Shop or the agent said.

### 2.3 Why the routing is this way

Routes are the URLs the server answers. Crash Test has one server process with one Fastify app. Fastify is the web framework. "Registered on one app" means every route, from every feature, is attached to the same `app` object in `apps/server/src/app.ts`. Today that object only has `/healthz`.

The planned URL groups:

```
  /shop/v1/*     Shop API. The agent under test calls this like a real merchant.
                 Auth: a per-run bearer token. Unknown token gives 401.
  /api/*         For the web UI, the CLI and the orchestrator. Runs, results, setup.
                 Some writes need an admin token.
  /runtime/*     Later (P1). Tools for external agents.
  /healthz       Liveness check for the host (Render calls it).
  everything     Built web app files (HTML, JS) served by the same process.
                 Anything else is a page the web app handles.
```

Why it is designed this way:

- **One process, one port.** The Node service serves the API and the built web app (ARCHITECTURE principle 7). The web page and `/api` share an origin, so no CORS setup is needed in production. Render's free tier also runs one web service.
- **The Shop and `/api` are separate by path and by auth.** The agent is handed the Shop URL and a Shop token. It never gets the admin token. The path prefix makes the split visible when you read the code.
- **The Shop is the part the agent can see.** Its replies are the only information the agent receives. That is why it must not leak test rules (rule 5).

---

## 3. M0 walkthrough: the scaffold

M0 is the first milestone: a pnpm monorepo with a shared package, a server, a web app, lint, tests and CI. Commit `d329759` added it. The acceptance test is `pnpm install && pnpm lint && pnpm typecheck && pnpm test` on a clean clone.

Repository shape after M0:

```
  package.json              root scripts and shared dev tools
  pnpm-workspace.yaml       which folders are packages
  tsconfig.base.json        shared compiler settings
  eslint.config.js          lint rules
  packages/shared/          zod schemas used by server AND web
  apps/server/              Fastify server
  apps/web/                 React app built by Vite
  scripts/                  PayPal spike scripts (M1)
  docs/                     setup notes and decision log
  .github/workflows/ci.yml  CI
  render.yaml               hosting stub
```

### 3.1 pnpm workspace and `workspace:*`

`pnpm-workspace.yaml` lists the folders that are packages:

```yaml
packages:
  - packages/*
  - apps/*
```

pnpm then installs everything into one shared store and links local packages together. `apps/server/package.json` says:

```json
"dependencies": {
  "@crash-test/shared": "workspace:*",
  "fastify": "^5.12.8"
}
```

`workspace:*` means "use the local folder, whatever version it has". pnpm creates a symlink at `apps/server/node_modules/@crash-test/shared` that points to `packages/shared`.

Now the resolution chain. When `apps/server/src/app.ts` does `import type { HealthResponse } from "@crash-test/shared"`, the tools follow this path:

```
  import "@crash-test/shared"
     |
     v
  apps/server/node_modules/@crash-test/shared      (symlink made by pnpm)
     |
     v
  packages/shared/package.json  "exports": { ".": ... }
     |-- "types"   -> ./dist/index.d.ts    (TypeScript reads this for types)
     |-- "default" -> ./dist/index.js      (Node runs this at runtime)
     |
     v
  packages/shared/dist/index.js            (made by: tsc -p tsconfig.build.json)
```

The `exports` map is the package's public door. `types` is listed first on purpose, because TypeScript looks for its entry through that key. Because the door points at `dist/`, the shared package must be built before anything that imports it. That is why the root scripts run `build:shared` first. DECISIONS.md records this as a decision.

### 3.2 Three-layer tsconfig

There are three layers. Each one extends the one above.

```
  tsconfig.base.json              compiler rules for the whole repo
     |
     +-- packages/shared/tsconfig.json     adds rootDir src, types: []
     |      +-- tsconfig.build.json         adds outDir dist, declaration, no tests
     |
     +-- apps/server/tsconfig.json         adds rootDir src, types: ["node"]
     |      +-- tsconfig.build.json         adds outDir dist, no tests
     |
     +-- apps/web/tsconfig.json            browser settings (jsx, Bundler, DOM)
```

The base file, `tsconfig.base.json`:

```json
"target": "ES2023",
"module": "NodeNext",
"moduleResolution": "NodeNext",
"strict": true,
"noUncheckedIndexedAccess": true,
"verbatimModuleSyntax": true,
"isolatedModules": true,
```

The flags that matter most:

| Flag                       | What it does                                                                     | Where you see it                                                    |
| -------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `strict`                   | Turns on the strict family: no implicit `any`, null checks, and so on            | Everywhere                                                          |
| `noUncheckedIndexedAccess` | `arr[0]` has type `T \| undefined`, not `T`                                      | `scripts/spike-paypal.ts` checks `if (!c)` after `capturesOf(o)[0]` |
| `verbatimModuleSyntax`     | Imports are emitted exactly as written. Type-only imports must say `import type` | `apps/server/src/app.ts`                                            |
| `isolatedModules`          | Each file must be safe to compile alone, which tools like esbuild need           | Vite and tsx                                                        |
| `module: NodeNext`         | Node's ESM rules apply: relative imports need a file extension                   | See below                                                           |

Why the imports say `./api.js`. The source file is `api.ts`, but the compiled file is `api.js`. Node's ESM loader needs the exact file name at runtime, with no guessing. So TypeScript asks you to write the name the file will have after compiling. Look at `packages/shared/src/index.ts`:

```ts
export * from "./api.js";
```

The file on disk is `api.ts`. The `.js` is still correct. The web app uses `moduleResolution: Bundler`, which does not need the extension, so the rule is per package.

### 3.3 Why shared has `"types": []`

`packages/shared/tsconfig.json`:

```json
"compilerOptions": { "rootDir": "src", "types": [] },
```

By default TypeScript pulls in every `@types/*` package it finds, including `@types/node`. That adds Node globals such as `process` and `Buffer`. The shared package is used by the browser too, so it must not compile against Node-only types. `types: []` turns off the automatic pull. If shared code accidentally uses `process`, the compiler now complains.

### 3.4 A zod schema is a type and a runtime check

`packages/shared/src/api.ts`:

```ts
import { z } from "zod";

export const HealthResponse = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponse>;
```

Two things share one name.

- `HealthResponse` (the value) is a zod schema. It exists at runtime and can check data: `HealthResponse.safeParse(x)`.
- `HealthResponse` (the type) is what `z.infer` derives from the schema. It exists only at compile time.

One definition gives you both. The server returns it, and the test parses the response with it:

```ts
// apps/server/src/app.ts
app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));
```

```ts
// apps/server/src/app.test.ts
expect(HealthResponse.parse(res.json())).toEqual({ status: "ok" });
```

If someone changes the schema, the server stops compiling and the test fails. Server and web cannot drift apart silently. That is the reason `shared` exists.

### 3.5 The server: `app.ts` and `index.ts`

The server is split into two files on purpose.

`apps/server/src/app.ts` builds the app and does not open a port:

```ts
export function buildApp({ logger }: { logger: boolean }) {
  const app = Fastify({ logger });
  app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));
  return app;
}
```

`apps/server/src/index.ts` starts it:

```ts
const port = Number(process.env.PORT ?? 3000);

const app = buildApp({ logger: true });
await app.listen({ port, host: "0.0.0.0" });
```

Why split: the test in `apps/server/src/app.test.ts` calls `app.inject(...)`. Fastify then handles the request in memory and never opens a port. Tests run fast, do not clash on ports, and do not need a network.

Why `host: "0.0.0.0"`: it means "listen on all network interfaces". The default in some setups is `127.0.0.1`, which only accepts connections from the same machine. A hosting platform such as Render sends traffic from outside the container, so the server must listen on all interfaces.

The `process.env.PORT` read is a shortcut that `index.ts` labels itself. It will be replaced by a zod-validated config in M2. This is the pattern the project uses for known shortcuts: a comment that says what the shortcut is and when it will go away.

### 3.6 The web app: `index.html` then `main.tsx`

Vite starts from the HTML file, not from JavaScript. `apps/web/index.html` contains:

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

Vite reads that script tag, follows the import graph from `main.tsx`, and bundles it. `apps/web/src/main.tsx` mounts React into the `#root` element:

```tsx
createRoot(root).render(
  <StrictMode>
    <h1>Crash Test</h1>
  </StrictMode>,
);
```

`StrictMode` runs some functions twice in development so bugs show up early. It has no effect in production. The page is only a placeholder at M0.

### 3.7 ESLint, Prettier and Vitest

Each tool has one job:

| Tool     | Job                                                    | Config                                                                 | Command              |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------- |
| ESLint   | Finds code mistakes (unused variables, risky patterns) | `eslint.config.js` (flat config, JS plus TypeScript recommended rules) | `eslint .`           |
| Prettier | Checks layout only (quotes, commas, line breaks)       | `.prettierrc.json` (empty, so defaults), `.prettierignore`             | `prettier --check .` |
| Vitest   | Runs the `*.test.ts` files                             | none at the root, found by file name                                   | `vitest run`         |

`.prettierignore` skips the lockfile and the three spec documents. Those files are kept exactly as written.

### 3.8 What each pnpm command runs

From the root `package.json`:

| Command          | What it actually runs                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`       | builds shared once, then runs every package's `dev` script in parallel: `tsc` watch for shared, `tsx watch` for the server, `vite` for the web |
| `pnpm build`     | runs `build` in every package, in dependency order (shared first)                                                                              |
| `pnpm start`     | `node dist/index.js` in the server. It runs compiled JavaScript, not TypeScript                                                                |
| `pnpm lint`      | `eslint .` then `prettier --check .`                                                                                                           |
| `pnpm typecheck` | builds shared, runs `typecheck` in each package (`tsc --noEmit`), then checks `scripts/`                                                       |
| `pnpm test`      | builds shared, then `vitest run` at the root, which finds tests in every package                                                               |

`pnpm -r` means "recursive": run the script in each workspace package. pnpm works out the order from the `workspace:*` links, so shared builds before the server.

### 3.9 CI and `--frozen-lockfile`

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm lint
- run: pnpm typecheck
- run: pnpm test
- run: pnpm build
```

`--frozen-lockfile` makes the install fail if `pnpm-lock.yaml` would need to change. The lockfile records the exact version of every dependency. Without this flag, CI could quietly install newer versions than your laptop used. The same logic is why the spec says "pin exact versions via the lockfile" (ARCHITECTURE section 3).

### 3.10 `render.yaml`

`render.yaml` tells Render how to host the app:

```yaml
services:
  - type: web
    name: crash-test
    runtime: node
    plan: free
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: "22"
```

Render runs the build once, then starts the server with `pnpm start`. It checks `/healthz` to decide whether the server is up. The file is a stub; section 14 of ARCHITECTURE and milestone M9 finish it.

### 3.11 `.gitignore`, `.env.example` and secrets

`.gitignore` has this pattern:

```
.env
.env.*
!.env.example
```

The first two lines hide every env file. The third line is an exception that keeps `.env.example` in git. The example file shows the names of the variables, with empty values and comments that say where each value comes from. Real values go only in your local env file, which never leaves your machine.

Other ignored items: `node_modules/`, `dist/` (build output, rebuilt by CI) and `*.db` (the SQLite file). `.vibe-wise/` is ignored too. That folder holds this learner profile.

### 3.12 MIT license

`LICENSE` is a plain text file with the MIT text and the line `Copyright (c) 2026 Gatik (gatik03)`. The points that matter:

- **Copyright is automatic.** The author owns the code from the moment it is written. You do not need to register it.
- **Public does not mean free to use.** Someone can read a public repo and still have no right to copy it. The license is the permission slip.
- **The LICENSE file is the whole procedure.** GitHub detects it and labels the repo. Nothing else is required.
- **MIT** lets anyone use, change, sell and redistribute the code, as long as the copyright line and the license text stay with it. There is no warranty.
- **Dependencies have their own licenses.** Your code can be MIT while a library you use is under a different license. Before adding a dependency, check that its license is compatible. AGENTS.md says a non-MIT dependency needs a human decision.

---

## 4. M1: the PayPal spike

M1 is a scripts-only experiment. It answers one question before any app code is written: can a vaulted sandbox wallet be charged, read back and refunded through the PayPal REST API, with the behavior we expect? If not, the design changes. This is risk R1 in the PRD.

Files:

- `scripts/paypal-spike-lib.ts`: shared helpers (token, one generic PayPal call, zod types for the order shape, email masking).
- `scripts/vault-wallet.ts`: one-time. Vaults the sandbox buyer's wallet and prints `WALLET_VAULT_ID`.
- `scripts/spike-paypal.ts`: repeatable. Charges, replays, reads back, refunds.
- `docs/PAYPAL_SETUP.md`: setup steps. Its Findings section is still empty.

Status: the scripts are written but have not yet been run against the real sandbox. The learner does not have sandbox credentials yet. So no real ids or findings exist yet.

Before the steps, one fact about the transport. Every call goes through one helper, `paypal(token, method, path, opts)`, which uses Node's built-in `fetch`:

```ts
const res = await fetch(`${PAYPAL_BASE}${path}`, {
  method,
  headers,
  body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
});
```

`PAYPAL_BASE` is `https://api-m.sandbox.paypal.com`. It is written as a constant, not read from the environment, so a config mistake cannot point the spike at the live host (rule 1).

### 4.1 Step: get a token

|                  |                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | `POST /v1/oauth2/token` with HTTP Basic auth (client id and secret, base64 encoded) and the body `grant_type=client_credentials`. The response holds `access_token` and `expires_in`.                                                                                                                                                                          |
| **Why**          | PayPal's REST API needs a bearer token on every other call. Client credentials give the app its own identity, with no human login.                                                                                                                                                                                                                             |
| **Alternatives** | **Cache in memory** until `expires_in` minus 60 seconds (the spec, ARCHITECTURE 7.2). Fast, and the secret never touches disk. **Fetch per request** (what the spike does). Simple, but wastes a round trip on every call. **Cache on disk.** Survives restarts, but writes a live credential into a file and gives little benefit, because tokens last hours. |

The spike fetches a fresh token each run, which is fine for a script. M2's real client will cache in memory, as the spec says. The log must never print the token (ARCHITECTURE 7.2).

### 4.2 Step: vault the buyer's wallet

|                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | `scripts/vault-wallet.ts` creates a $1.00 order with `store_in_vault: ON_SUCCESS`. The order comes back `PAYER_ACTION_REQUIRED` with an approval link. The learner opens the link, logs in with the sandbox personal account and approves. The script polls the order status every 3 seconds, for up to 10 minutes, until it reads `APPROVED`. It then captures the order and polls again until the vault reports `VAULTED`. Finally it prints `WALLET_VAULT_ID=...`.                                                                                                                                                                                                                                            |
| **Why**          | A vault id is a token that stands for a saved buyer wallet. Later orders can charge that id with no buyer popup. This is what lets the agent buy without a human present. The one human step happens once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Alternatives** | **A. Save during a purchase** (the spec, ARCHITECTURE 7.4). Uses the normal order flow with vault attributes. **A-prime. Payment Method Tokens API.** A two-step setup token then payment token flow. It is not in the spec. Check PayPal's current docs before choosing it, and record the choice in DECISIONS.md. **B. Card payment source.** Charges a sandbox test card, no popup. Needs the card capability on the sandbox business account, and test card data must stay in env vars. **C. Browser automation.** A headless browser logs in as the buyer and clicks approve. Slow (10 to 20 seconds per order) and brittle when the page changes. **D. Mock.** Only for hosted demos, never for gold runs. |

The learner's choice here: detect the buyer's approval by polling PayPal, not by waiting for the browser to redirect. The order status is ground truth. A redirect can fail even when the buyer approved. The script also does not care where the browser lands, which is why the return URL is a placeholder.

The same loop shape appears in the script:

```ts
while (status !== "APPROVED") {
  if (Date.now() > deadline)
    throw new Error(`Timed out waiting for approval (last status ${status}).`);
  await sleep(APPROVAL_POLL_MS);
  const next = (await getOrder(token, created.id)).status;
  if (next !== status) console.log(`status: ${status} → ${next}`);
  status = next;
}
```

The loop has a deadline, so a stuck buyer cannot hang the script forever. That is a rule you should reuse: every wait needs a limit.

### 4.3 Step: charge with `vault_id`

|                  |                                                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | `POST /v2/checkout/orders` with `intent: "CAPTURE"`, a purchase unit whose `amount.value` is `"17.49"` (item 9.99 plus handling 7.50), an item list, and `payment_source.paypal.vault_id`. The spike expects status `COMPLETED` right away. It sends a `PayPal-Request-Id` header.  |
| **Why**          | One call creates the order and moves the money. The vault id replaces the buyer's login. The request id makes the call safe to retry (see 4.6).                                                                                                                                     |
| **Alternatives** | **CAPTURE** (used here): money moves in this call. **AUTHORIZE:** reserves the money and needs a second call to capture it later. Crash Test needs captures, because the audit counts captured money, not reserved money. An authorization that is never captured is not a payment. |

Amounts are strings with two decimals in PayPal's format. Inside the project they are integers in cents. The spec gives the boundary conversion (ARCHITECTURE 5.2):

```ts
export const toPayPal = (m: Money) => (m.minor / 100).toFixed(2);
```

The spike uses literal strings like `"17.49"`, so it does no arithmetic at all. Here is why integers matter. In JavaScript, `0.1 + 0.2` gives `0.30000000000000004`. Money in floats drifts, and a drift of a fraction of a cent is enough to fail an exact-match assertion. Integers do not drift: `1749 + 0` is always `1749`. Format to a decimal string only at the PayPal boundary.

The spike also checks the order's `status` and the capture's `amount.value`. The first check is the proof that no buyer popup was needed.

### 4.4 Step: read the order back (ground truth)

|                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | `GET /v2/checkout/orders/{id}`. The spike reads `purchase_units[0].payments.captures` and checks that there is exactly one capture for $17.49.                                                                                                                                                                                                                                                                                                              |
| **Why**          | Ground truth (rule 3). PayPal's own record decides what happened. The spike's own variables are not evidence.                                                                                                                                                                                                                                                                                                                                               |
| **Alternatives** | **Our own records** (what we think we sent). Fast and easy, but wrong whenever a request timed out and we do not know whether PayPal acted. **Webhooks** (PayPal pushes an event to us). Helpful for corroboration, but they can arrive late, arrive twice, or never arrive. The spec uses webhooks only to set `ledger_completeness`, never for a verdict (ARCHITECTURE 7.8). **Read the order** (the choice). It is a plain GET, so it is safe to repeat. |

### 4.5 Step: refund partially, then the rest

|                  |                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | `POST /v2/payments/captures/{capture_id}/refund`. First with `amount: 9.00` (partial), then with an empty body (the rest). Then the spike reads the order again.                                     |
| **Why**          | Refunds are how a bad purchase is undone in the cleanup step, and S07 tests recovery from a partial refund. Doing both kinds in the spike tells us the exact behavior before the code depends on it. |
| **Alternatives** | **One full refund only.** Simpler, but it leaves the partial case untested. **Refund by order id.** The spec refunds by capture id, which is the more specific target.                               |

The empty body is the important detail: it means "refund what is left". The spike prints where refunds show up in the order read. That answer is still unknown and goes into PAYPAL_SETUP.md once run.

### 4.6 Step: idempotency (the replay and the control)

Idempotency means "doing the same thing twice has the same effect as doing it once". It matters because a network call can time out after PayPal has already acted. If the caller retries, a second charge could happen.

PayPal's answer is the `PayPal-Request-Id` header. The spec says the same id replays the stored original response for a limited window (ARCHITECTURE 7.3).

|                  |                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**         | Step 3 sends the same charge with the same request id (R1) a second time. It checks the replay returned the same order id and the same capture id. Step 4 is the control: a new request id and a different reference must create a different order. Then the control's capture is refunded.                                                                                                                                                   |
| **Why**          | The replay check alone is not enough. If the second call simply made a second order, the comparison would still look like it failed in the right way. The control shows that the check can really tell two orders apart. Without the control, a passing replay test proves nothing.                                                                                                                                                           |
| **Alternatives** | **PayPal's request id** (the choice). PayPal stores the result, so we need no table. **Our own dedupe table.** We store each request id and its result. It works, but we then have to keep it correct across crashes, and PayPal already does this. **Check, then POST.** First GET to see whether the order exists, then create it if not. Two requests can both see "no order" and both create one. A check is never atomic with the write. |

The learner's design, from the decision log: idempotency is proven by comparing the order ids of the original and the replay, plus the control, plus a GET that confirms exactly one capture. The GET matters because an order id can match while the money moved twice, so the spike checks the capture count too.

The control order is refunded right away, so the sandbox balance goes back to where it was. A test that moves money must always put it back.

### 4.7 Cross-cutting choices

| Choice                  | What we do                                                                                                                                                                                                                                                | Where it is written                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `fetch` vs a PayPal SDK | Plain `fetch`. The spike must show the real HTTP calls, and a few helpers do not justify a dependency (AGENTS.md's actual rule is to ask before adding a paid service or a non-MIT dependency). An SDK would hide the calls this spike exists to examine. | Spike header comment                      |
| Script config           | `node --env-file=<local env file> scripts/...` runs TypeScript directly on Node 22. No dotenv or tsx needed                                                                                                                                               | DECISIONS.md                              |
| Env validation          | zod parses the env vars and reports names only, never values                                                                                                                                                                                              | `scripts/paypal-spike-lib.ts` (`loadEnv`) |
| Email masking           | `buyer@example.com` shows as `b***@example.com`                                                                                                                                                                                                           | `maskEmail` in the same file              |

---

## 5. M2 core domain, piece 1: money, ledger, events, rails

M2 builds the domain the rest of the app stands on. This first piece covers the shared types in `packages/shared/src/{money,ledger,events}.ts` and the `Rail` interface with `MockRail` in `apps/server/src/rails/`. `PayPalSandboxRail` and SQLite are not written yet.

### 5.1 Integer `Money`

```ts
export const Money = z.object({
  minor: z.number().int().safe(),
  currency: Currency,
});
```

`minor` is the amount in minor units: cents for USD. `$17.49` is `{ minor: 1749, currency: "USD" }`. `.int()` rejects `17.49`, and `.safe()` rejects integers too large for JavaScript to hold exactly. `Currency` is the literal `"USD"` for now. `add`, `sub` and `compare` throw a `TypeError` on a currency mismatch, so two currencies can never be mixed silently.

Why cents: integers add and compare exactly. `0.1 + 0.2` is `0.30000000000000004` in JavaScript, and an auditor that checks "captured equals quoted" needs exact equality.

| Option                     | Exact?                  | Cost                                                                             | Verdict                                     |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| Floats (`17.49`)           | No, drifts              | Rounding bugs that appear only on some amounts                                   | Rejected by AGENTS rule 2                   |
| Integer cents (what we do) | Yes                     | You must convert at the PayPal edge, and a second currency needs per-unit rules  | Chosen. Needs only `Number`, no dependency  |
| A decimal library          | Yes, any decimal places | A new dependency, and amounts become objects that do not serialize as plain JSON | Overkill for one currency with two decimals |

### 5.2 `toPayPalValue` and `fromPayPalValue`

PayPal wants amounts as strings such as `"17.49"`. These two functions are the only place that conversion happens.

```ts
export function toPayPalValue(m: Money): string {
  const abs = Math.abs(m.minor);
  const cents = String(abs % 100).padStart(2, "0");
  return `${m.minor < 0 ? "-" : ""}${(abs - (abs % 100)) / 100}.${cents}`;
}
```

It splits the integer with `%` and subtraction, never a float division. `5` becomes `"0.05"` because `padStart` fills the cents to two digits.

```ts
const PAYPAL_VALUE = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
```

`fromPayPalValue` is strict. The regex accepts a whole part that is `0` or starts with 1-9, then optionally a dot and one or two digits. It refuses signs, spaces, exponents like `1e2`, three decimals, and an empty string, and throws a `RangeError`. Parsing a string like `"17.5"` is exact: the fraction `"5"` is padded to `"50"` and the whole part is multiplied by 100, so every step is integer arithmetic. No float ever holds the amount.

Leading zeros are rejected (`"007.50"` fails) because they signal a string that did not come from a normal PayPal response. A parser that quietly accepts odd input can hide a bug upstream, and the auditor should fail loudly instead.

### 5.3 Ledger types as ground truth

`ledger.ts` defines what the rail reports back. `RailOrder` holds the order, its line items and an array of `RailCapture`; each capture holds its `RailRefund` list. The comment on `RailOrder` says it is "Ground truth for one order, as read back from the rail". `LedgerSnapshot` adds `net_captured`, `capture_count` and an optional `ledger_completeness` (`ok`, `webhook_extra` or `missing`), and its comment says it counts only COMPLETED captures and refunds.

These are zod schemas, so a response from PayPal can be parsed and checked before the auditor trusts it. The same file holds the request and result shapes (`ChargeRequest`, `ChargeResult`, `RefundRequest`, `RefundResult`). In `RefundRequest`, an omitted `amount` means "refund whatever is still refundable". Because they all live in `packages/shared`, the server and web app agree on one shape.

### 5.4 Events as a discriminated union

```ts
export const AppEvent = z.discriminatedUnion("type", [
  event(
    "rail.charge.intent",
    z.object({ requestId: z.string(), request: ChargeRequest }),
  ),
  // ...
]);
```

A union means "one of several shapes". A discriminated union means every shape carries one shared field, here `type`, with a different literal value in each, such as `"rail.charge.intent"`. Reading `type` tells you which shape you have. zod looks at that field first and validates against only the matching schema, so errors point at the right shape, and TypeScript narrows the payload type inside a `switch (e.type)`.

Every event shares an envelope: `scenarioRunId`, a non-negative integer `seq`, and an ISO 8601 UTC `ts`. The rail events (`rail.charge.intent`, `rail.charge.result`, `rail.charge.error`) and `cleanup.refund` have typed payloads. The other kinds (`run.started`, `agent.step` and so on) use an open record, because the spec does not fix their payloads yet. Storing every event is how verdicts can be recomputed later (AGENTS rule 7).

### 5.5 One `Rail` interface, two implementations

```ts
export interface Rail {
  readonly kind: "paypal-sandbox" | "mock";
  preflight(): Promise<RailHealth>;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  getOrder(orderId: string): Promise<RailOrder>;
  recoverByRequestId(req: ChargeRequest): Promise<ChargeResult | null>;
}
```

The Shop, auditor and agent code talk only to `Rail`. `MockRail` is in memory and deterministic, for tests, CI and runs without keys. `PayPalSandboxRail` (later) calls the real sandbox. Callers cannot tell which one they hold, so the same Shop code is tested fast against the mock and proven against PayPal. Failures use one `RailError` class with a `code` of `not_found`, `invalid_request` or `refund_exceeds_captured`.

### 5.6 `MockRail`: idempotency and the refund remainder

Idempotency is a map from request id to the first result:

```ts
const replay = this.charges.get(req.requestId);
if (replay) return Promise.resolve({ ...replay });
```

A second `charge` with the same `requestId` returns the original result, even if the body differs, and creates no second order. This copies PayPal's `PayPal-Request-Id` behavior from section 4.6. The mock also rejects a charge whose total differs from items plus fees, as PayPal does.

Refunds compute what is left, then allow only that much:

```ts
let refunded: Money = { minor: 0, currency: capture.amount.currency };
for (const r of capture.refunds) refunded = add(refunded, r.amount);
const remaining = sub(capture.amount, refunded);
const amount = req.amount ?? remaining;
if (amount.minor <= 0 || compare(amount, remaining) > 0) {
  // throws RailError("refund_exceeds_captured", ...)
}
```

Leaving `amount` out refunds the remainder. A refund of zero, or more than the remainder, is rejected. Refunds have their own request-id map, so replaying a refund does not refund twice.

### 5.7 `railContract(makeRail)`: one test suite for every rail

```ts
export function railContract(makeRail: () => Rail | Promise<Rail>): void {
  // ...
  describe("Rail contract", () => {
    /* it(...) cases */
  });
}
```

`railContract` takes a function that makes a rail and registers the same tests for it: charge matches the total, same request id replays, a different body with the same id still returns the original, partial then full refund, refunds beyond the captured amount fail, and a repeated refund id refunds once. `MockRail` runs it always. Later the real sandbox rail will run the same suite behind `SANDBOX_TESTS=1`, which proves the mock behaves like PayPal, or shows where it does not.

| Option                            | Upside                                                 | Downside                                                      |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Separate tests per implementation | Each file can test implementation details              | The two suites drift apart, and the mock can silently diverge |
| One shared contract (what we do)  | The mock and the real rail are held to identical rules | Tests must only use the `Rail` interface, not internals       |

### 5.8 Self-check

1. Why is `minor` an integer, and what do `.int()` and `.safe()` each reject?
2. Why does `fromPayPalValue` reject `"007.50"` and `"1e2"`?
3. What field makes `AppEvent` a discriminated union, and what does zod do with it?
4. What does `MockRail.charge` return when called twice with the same `requestId` but a different total?
5. Why run the same `railContract` against the mock and the sandbox rail?

<details>
<summary>Answers</summary>

1. Integers add and compare exactly, unlike floats. `.int()` rejects non-integers like `17.49`. `.safe()` rejects integers too large to be held exactly.
2. The regex allows only `0` or a number starting with 1-9, then up to two decimals. Leading zeros and exponents are not what PayPal sends, so a strict parser fails loudly on them.
3. `type`. zod reads it first, validates only the matching shape, and TypeScript narrows the payload by it.
4. The original result, with no second order created (the contract test "same requestId with a different body" checks this).
5. It holds both to the same behavior, so tests written against the fast mock are trustworthy, and any difference from PayPal shows up as a failing contract test.

</details>

---

## 6. Self-check questions

Try each question before opening the answer.

### 6.1 Section 1: what Crash Test is

1. In one sentence, who decides whether an agent passed a scenario, and why not the LLM?
2. Why does the Auditor call PayPal itself instead of reading the Shop's database?
3. Why is the Shop "policy-blind", and what would go wrong if it knew the test rules?

<details>
<summary>Answers</summary>

1. Deterministic code decides, using PayPal's ground-truth records. LLM output is random and can be wrong, so it must never decide pass or fail. Rule 4.
2. The Shop's database is our own bookkeeping. If a request timed out, our record might say one thing while PayPal did another. The audit is only useful if it checks PayPal's record (rule 3).
3. The agent is supposed to behave in the real world, where the merchant does not know the test. If the Shop knew the rules, it could hint at them or behave differently, and the test would measure the hint, not the agent (rule 5).

</details>

### 6.2 Section 2: architecture and routing

1. Which URL prefix is for the agent, and which for the human UI? How does the split show up in auth?
2. Why does one Node process serve both the API and the built web app?
3. In a scenario run, which component calls PayPal to check the result, and why does it do that instead of the Shop?
4. What does "registered on one app" mean for the `/healthz` route?

<details>
<summary>Answers</summary>

1. `/shop/v1/*` is for the agent, and `/api/*` is for the web UI, CLI and orchestrator. The agent uses a per-run Shop bearer token. Admin writes under `/api` need an admin token. The agent never gets the admin token.
2. It is one deployable (principle 7). The page and `/api` share an origin, so there is no CORS setup in production, and Render's free tier runs one web service.
3. The Auditor, through the Rail, calls `getOrder` on PayPal. It does this because PayPal's record is the ground truth (ARCHITECTURE 2.1 and 5.5).
4. The route is attached to the single Fastify `app` object built in `apps/server/src/app.ts`. Every feature adds its routes to that same object, so there is one place to see all of them.

</details>

### 6.3 Section 3: M0 scaffold

1. Trace the import `import type { HealthResponse } from "@crash-test/shared"` from `app.ts` to the file that runs at runtime. Name the three hops.
2. Why does `packages/shared/tsconfig.json` set `"types": []`?
3. Why does `shared/src/index.ts` import `./api.js` when the file on disk is `api.ts`?
4. Why does `ci.yml` use `pnpm install --frozen-lockfile`?
5. Why are `app.ts` and `index.ts` separate files?

<details>
<summary>Answers</summary>

1. (a) The pnpm symlink at `apps/server/node_modules/@crash-test/shared`. (b) The `exports` map in `packages/shared/package.json`. The `default` condition points to `./dist/index.js`. (c) `packages/shared/dist/index.js`, which exists because `tsc -p tsconfig.build.json` built it. TypeScript uses the `types` condition, which points to `dist/index.d.ts`.
2. Without it, TypeScript includes every `@types` package, including Node's globals. Shared code is also used by the browser, so it must not depend on Node types. Setting `types: []` makes the compiler reject Node-only code.
3. Node's ESM rules need the exact runtime file name. TypeScript with `module: NodeNext` requires the name the file will have after compiling.
4. It makes the install fail if the lockfile would change, so CI uses the exact dependency versions the lockfile records. Without it, CI could quietly install different versions.
5. `app.ts` builds the app without opening a port, so `app.inject()` can test it in memory. `index.ts` is the only file that calls `listen`.

</details>

### 6.4 Section 4: M1 PayPal spike

1. Why does the spike compare the replay's order id to the original, and why is the control charge needed too?
2. What is the difference between CAPTURE and AUTHORIZE, and why does the audit care?
3. Why is `0.1 + 0.2` a problem for money, and what does Crash Test store instead?
4. Name two alternatives to using `PayPal-Request-Id` for idempotency and say why each is weaker.
5. What makes the approval loop in `vault-wallet.ts` safe from hanging forever?

<details>
<summary>Answers</summary>

1. The replay check tests whether PayPal returns the stored original. The control proves the check can tell two different orders apart. Without the control, a "same id" result could be a broken check, not idempotency.
2. CAPTURE moves money in one call. AUTHORIZE only reserves it, and a later capture moves it. The audit counts captured money (`net_captured`, `capture_count`). A bare authorization never becomes a payment.
3. Floats cannot represent most decimal amounts exactly, so totals drift by tiny amounts that fail exact checks. Crash Test stores integer cents (`Money {minor, currency}`) and formats to a two-decimal string only at the PayPal boundary.
4. Our own dedupe table (we must keep it correct across crashes, which PayPal already does). Check-then-POST (two requests can both see no order and both create one).
5. It has a deadline. The loop checks the time on each pass and throws once the 10-minute limit is passed.

</details>

---

## 7. Milestone log

Each milestone gets a short entry. New entries are appended here as milestones land.

### M0: scaffold (commit `d329759`, 2026-11-07)

- Built: pnpm workspace, shared zod package, Fastify server with `/healthz`, React placeholder, ESLint, Prettier, Vitest, CI, `render.yaml` stub, `.env.example`, MIT license.
- Key ideas: `workspace:*` links and the `exports` chain (3.1), the three-layer tsconfig (3.2), zod as type plus validator (3.4), `app.ts` split for `inject` tests (3.5), `--frozen-lockfile` in CI (3.9).
- Open items: the server still reads `PORT` raw (a labelled shortcut until M2).

### M1: PayPal spike (scripts written, not committed, first sandbox run pending)

- Built: `scripts/paypal-spike-lib.ts`, `scripts/vault-wallet.ts`, `scripts/spike-paypal.ts`, and setup notes in `docs/PAYPAL_SETUP.md`.
- Key ideas: approval by polling order status (4.2), idempotency proven by replay plus control plus a one-capture GET (4.6), integer cents at the boundary (4.3).
- Open items: the sandbox run has not happened. Once it does, record the real statuses, HTTP codes, replay behavior, and where refunds appear in the Findings section of `docs/PAYPAL_SETUP.md`. Any difference from ARCHITECTURE section 7 goes into DECISIONS.md, per rule 10.

### M2 piece 1: money, ledger, events, rails (in progress, not committed)

- Built: `Money` with integer cents and strict PayPal string conversion, ledger and charge/refund schemas, the `AppEvent` discriminated union, the `Rail` interface, `MockRail`, and the shared `railContract` suite (section 5).
- Key ideas: cents instead of floats (5.1), strict parsing (5.2), one interface with two implementations (5.5), a contract suite reused for every rail (5.7).
- Open items: `PayPalSandboxRail` (write-ahead log, `recoverByRequestId`, `getOrder`, `refund`) and the SQLite migrations and repo are still to do, as is ledger reconciliation. The contract suite has not yet run against the sandbox rail.
