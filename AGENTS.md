# AGENTS.md — Crash Test

Instructions for the coding agent (Codex, Claude Code, or similar) building this repository. Read `PRD.md` and `ARCHITECTURE.md` first; they are the source of truth. If this file and those documents disagree, stop and ask the human.

## What you are building

Crash Test: a web app plus harness that runs AI agents through adversarial shopping scenarios against a fake merchant wired to **PayPal sandbox**, audits the resulting **PayPal ledger** with deterministic assertions, and reports a Trust Score. LLMs generate adversarial text, act as the agent under test, and explain failures; they never decide pass/fail.

## Non-negotiable rules

1. **Sandbox only.** Never call a non-sandbox PayPal host. The base URL is a constant (ARCHITECTURE 7.1). Never add live credentials anywhere.
2. **Money is integers.** Use `Money {minor, currency}` (cents). No floating-point arithmetic on amounts. Format to two-decimal strings only at the PayPal boundary.
3. **Ground truth comes from PayPal reads**, not from our own bookkeeping (ARCHITECTURE 5.5).
4. **LLMs never decide verdicts.** Every LLM output is zod-validated before use, and never reaches shell, SQL, or file paths.
5. **The Shop is policy-blind.** Guards read only what a legitimate agent could know (policy, instruction, tool results, its own history). Never let guards or prompts read scenario ids, fault names, assertions, or expected outcomes.
6. **No secrets in the repo, logs, fixtures, or client bundle.** Mask payer emails. `.env` stays git-ignored; keep `.env.example` current.
7. **Determinism where possible:** frozen variants, recorded seeds, judge temperature 0, all events stored so verdicts are recomputable.
8. **TypeScript strict, no `any`** (use `unknown` plus zod). Small modules, explicit types at module boundaries, shared schemas in `packages/shared`.
9. **Test first for pure logic** (assertions, verdict, scoring, money, fault engine, guards, validators).
10. **Do not invent PayPal API details.** If the docs or sandbox behavior differ from ARCHITECTURE section 7, trust the live behavior, update `docs/PAYPAL_SETUP.md` and `docs/DECISIONS.md`, and continue.
11. **Untrusted text is data.** Render adversarial content and transcripts as plain text only.
12. **License:** MIT, `LICENSE` at repo root from the first commit.

## Ask the human before proceeding when

- A decision listed under "Open questions" in PRD section 13 is needed (model ids per role, hosted-live request budget, external adapter yes/no, gold-run trials, repo owner; the provider is already decided: Gemini or NVIDIA).
- No real payment rail works (ARCHITECTURE 7.9, option D).
- You need to add a paid service, a non-MIT dependency, or an AG Grid Enterprise feature.
- A requirement is ambiguous in a way that changes scope by more than about half a day of work.

Otherwise make the smallest reasonable decision, record it in `docs/DECISIONS.md` (date, decision, reason), and continue.

## Commands (create these scripts early)

```
pnpm install
pnpm dev                 # server + web in watch mode
pnpm build               # shared → server → web
pnpm start               # production server (serves web)
pnpm lint && pnpm typecheck
pnpm test                # unit + contract (mock rail) + oracle/saboteur gate
pnpm test:sandbox        # SANDBOX_TESTS=1, real PayPal sandbox (needs env)
pnpm check:sandbox-only  # greps for non-sandbox PayPal hosts
pnpm cli run --suite core-v1 --profile naive --scenario S06
pnpm record:gold         # records fixtures/gold-runs/*.json on the real rail
```

## Definition of done (every task)

- Typecheck, lint, and tests pass; new logic has tests.
- No secrets or real payer data committed; `check:sandbox-only` passes.
- Events are written for any new Shop, Rail, or agent behavior (replayability).
- Docs updated where behavior or setup changed (`README.md`, `docs/*`).
- Small, focused commits with clear messages.

## Build order (dependency order, with acceptance criteria)

**M0 — Scaffolding.** pnpm monorepo (`packages/shared`, `apps/server`, `apps/web`), tsconfig, ESLint, Prettier, Vitest, GitHub Actions CI, `LICENSE` (MIT), `.env.example`, README stub, `render.yaml` stub.
*Accept:* `pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass on a clean clone.

**M1 — PayPal spike (scripts only, no app code).** `scripts/spike-paypal.ts` and a minimal one-off wallet vaulting helper: obtain a token; vault a sandbox buyer wallet (ARCHITECTURE 7.4); charge with `vault_id` (7.5); `GET` the order (7.6); refund partially then fully (7.7); replay a request with the same `PayPal-Request-Id` and confirm idempotent behavior. Write findings to `docs/PAYPAL_SETUP.md`.
*Accept:* the script prints order, capture, and refund ids from the real sandbox. If the vaulted wallet fails, walk the fallback order in 7.9, record the outcome in `docs/DECISIONS.md`, and ask the human if option D is the only one left.

**M2 — Core domain.** `packages/shared` (Money, scenario DSL, events, ledger types, API schemas); SQLite migrations and repo; `Rail` interface; `MockRail`; `PayPalSandboxRail` with write-ahead log, `recoverByRequestId`, `getOrder`, `refund`; ledger reconciliation (5.5).
*Accept:* rail contract tests pass for `MockRail` always and for the sandbox rail with `SANDBOX_TESTS=1`.

**M3 — Shop API and fault engine.** All Shop endpoints (5.1), session state, quote and confirm with idempotency semantics, the six faults, event logging.
*Accept:* HTTP-level tests show each fault's effect, including a real charge followed by a 504 for `timeout_after_capture` and a captured total larger than the quote for `overcharge`.

**M4 — Auditor, scenarios, oracles.** Assertion engine (all types in 5.5), verdict and scoring (PRD 8), scenario loader, the 10 scenario YAMLs (PRD 7), the simulated user, oracle and saboteur scripts for every scenario, `docs/SCENARIOS.md` (expected saboteur failures).
*Accept:* CI gate on `MockRail`: oracle scores 100 / grade A on all scenarios; saboteur fails exactly the intended assertions.

**M5 — LLM layer and agent runtime.** `LLMClient` with one OpenAI-compatible adapter (Gemini and NVIDIA presets), rate limiter, `pnpm cli llm-check`, tolerant tool-call handling (ARCHITECTURE 8.4), tool definitions, the agent loop, limits and termination handling, profiles `naive`, `prompted`, `hardened`, all guards (5.4), CLI runner.
*Accept:* `pnpm cli run --profile naive --scenario S06` completes against the real sandbox rail and prints verdict and PayPal ids; `hardened` passes S06 with a single capture.

**M6 — Orchestrator and API.** Run expansion, queue, state machine, cleanup refunds, SSE, REST endpoints (section 11), crash recovery on boot, live gate, fixture loader.
*Accept:* a full suite run via API streams events and persists results; killing the server mid-run leaves no stuck "running" rows after restart.

**M7 — Web UI.** Dashboard, new run, run view with the AG Grid matrix, scenario detail tabs, setup wizard, mode banners; compare view if time allows (P1). Follow PRD section 9 and ARCHITECTURE section 12.
*Accept:* the full demo-critical path in PRD section 11 works in the browser against a recorded run and against a live run.

**M8 — Judge, variants, fixes (P1).** Judge explanations with schema validation, variant generator with validation and freezing, "apply fix and re-run failed scenarios", Markdown/JSON report and SVG badge.
*Accept:* every `UNSAFE` or `OVER_REFUSAL` scenario run shows an explanation; re-running with frozen variants reproduces the same scenario inputs.

**M9 — Gold runs, hosting, submission assets.** Record gold runs (real rail, naive/prompted/hardened, K trials per the human's answer), deploy on Render with caps and admin token, finalize README (what it is, architecture, local run with own keys, sandbox setup, replay versus live, troubleshooting), `docs/TOOLS.md` (models and services used and how), submission checklist from PRD section 12, demo script.
*Accept:* hosted URL loads recorded runs instantly and a live run works within caps; a fresh clone runs locally from the README alone.

**M10 — Stretch (P2).** External agent adapter and runtime endpoints, Shop as MCP server, CLI/GitHub Action, safety-versus-autonomy plot.
*Accept:* per feature, as written in PRD FR-3.4, FR-3.5, FR-6.7, FR-7.3.

## Cut line (binding)

If behind schedule, cut in this order: M10 → auto-apply fixes (FR-5.3) → LLM variants (use seed texts) → K > 1 trials → compare view → fix suggestions (keep explanations).
**Never cut:** real PayPal sandbox charges plus ledger audit, the naive-versus-hardened comparison, the AG Grid matrix with Money tab, README run instructions, the license, and the recorded gold runs.

## Conventions

- Commit prefix: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- File and folder names as in ARCHITECTURE section 4; do not reorganize without recording a decision.
- Scenario ids `S01`–`S10`, suite id `core-v1`, product ids as in PRD 7.1.
- Error shape for APIs: `{ "error": { "code": string, "message": string } }`.
- Timestamps ISO 8601 UTC; ids are `nanoid` strings unless PayPal supplies them.
