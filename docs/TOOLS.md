# Tools and services

Every model and service Crash Test uses, and how.

## PayPal sandbox (central)

Sandbox only; the base URL is a constant and `pnpm check:sandbox-only` rejects any other PayPal host.

- **Orders v2 with a vaulted wallet:** the Shop's checkout calls `POST /v2/checkout/orders` with a `vault_id` for a sandbox buyer wallet (vaulted once with `pnpm spike:vault`), so a charge completes with no buyer popup and really moves sandbox money.
- **`PayPal-Request-Id` idempotency:** every charge and refund carries a request id. A replay with the same id returns the stored original (HTTP 200), which is what the S06 timeout-retry scenario tests. A write-ahead log and `recoverByRequestId` let the rail find out whether a charge that timed out actually happened, without risking a new one.
- **Order reads as ground truth:** after each scenario the auditor calls `GET /v2/checkout/orders/{id}` for every order and builds the ledger (captures, refunds, amounts) from PayPal's answer, not from Crash Test's own bookkeeping. Assertions run on that ledger.
- **Refunds:** `POST /v2/payments/captures/{id}/refund`, full or partial. Used by agents that correct an overcharge (S07) and by the harness's cleanup refunds after the audit snapshot.
- Findings from the real sandbox: [PAYPAL_SETUP.md](PAYPAL_SETUP.md). Sandbox accounts must be US.

## LLM: Google Gemini via its OpenAI-compatible endpoint

A hand-written adapter on Node's `fetch` talks to `chat/completions` (no SDK). NVIDIA's OpenAI-compatible API is the alternative preset. Models are verified with `pnpm cli llm-check` (a forced tool call).

| Role              | Model                   | Use                                                            |
| ----------------- | ----------------------- | -------------------------------------------------------------- |
| Agent under test  | `gemini-3.5-flash`      | Drives the `naive`, `prompted` and `hardened` shopping agents. |
| Judge (explainer) | `gemini-3.5-flash`      | Configured; explanation feature not built yet.                 |
| Variant generator | `gemini-3.1-flash-lite` | Configured; variant generation not built yet.                  |

- **Tool calling:** the shop tools (`search_products`, `add_to_cart`, `create_quote`, `confirm_checkout`, `list_orders`, `get_order`, `refund_order`, `ask_user`, `request_approval`, `finish`) are passed as function tools; malformed tool calls are tolerated and counted, and three in a row end the run.
- **Rate limiter:** one limiter shared by all roles spaces requests evenly (`LLM_MAX_RPM`, default 10); retries honor `Retry-After` and back off with jitter. Time spent queued is not charged to the agent's time budget.
- The LLM never decides pass/fail. Its outputs are validated before use and never reach a shell, SQL or file path.
- Gemini 2.5 ids return 404 for new keys; see [DECISIONS.md](DECISIONS.md).

## Hosting and libraries

- **Render:** hosts the single web service (Blueprint in `render.yaml`).
- **AG Grid Community:** the run matrix (column group per profile, verdict chip cells, live change flash) and the Money tab grid of PayPal ids and amounts.
- **Fastify:** REST and SSE API, and static serving of the built web app.
- **SQLite** (via the server's DB layer): runs, events, ledger entries, assertion results; fixtures re-seed it on boot.
- **zod:** validates config, scenarios, events, API bodies and every LLM output.
- **Vitest:** unit, rail contract, and oracle/saboteur gate tests.
- **React and Vite:** the web UI.

## How it was built

Built with Claude Code (Anthropic) as the coding agent, working from `PRD.md`, `ARCHITECTURE.md` and `AGENTS.md`, with the human making product decisions.
