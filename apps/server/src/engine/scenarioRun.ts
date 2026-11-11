import {
  fromPayPalValue,
  type AppEvent,
  type Scenario,
} from "@crash-test/shared";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import type { Db } from "../db/db.js";
import { upsertLedgerEntries } from "../db/repo.js";
import { insertAssertionResult } from "../db/runsRepo.js";
import type { EventSink } from "../events/sink.js";
import type { Body, ToolResult, Tools } from "../oracles/harness.js";
import type { Rail } from "../rails/Rail.js";
import { simulatedUser } from "../scenarios/simulatedUser.js";
import { CATEGORY_BY_SKU } from "../shop/catalog.js";
import type { ShopSessions } from "../shop/session.js";
import { runScenarioAudit, type ScenarioAudit } from "./runner.js";

export type AgentRunStats = {
  termination: string;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  /** Infrastructure failure (LLM or rail unavailable): the run's verdict is ERROR. */
  error?: string;
};

/** What a profile hands the orchestrator; scripted and LLM agents alike. */
export type RunnableAgent = { run(t: Tools): Promise<AgentRunStats | void> };

/** A sink that can also read back one scenario run's events for the audit. */
export type ReadableSink = EventSink & {
  for(scenarioRunId: string): AppEvent[];
};

export type Injector = {
  inject(opts: InjectOptions): Promise<LightMyRequestResponse>;
};

export type ScenarioRunResult = {
  audit: ScenarioAudit;
  stats: AgentRunStats;
  /** Set when the agent threw or reported an infrastructure error. */
  error?: string;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One scenario run: Shop session, agent, ledger audit from rail reads, persistence. */
export async function runScenario({
  scenario,
  agent,
  rail,
  sink,
  scenarioRunId,
  shopSessions,
  app,
  db,
}: {
  scenario: Scenario;
  agent: RunnableAgent;
  rail: Rail;
  sink: ReadableSink;
  scenarioRunId: string;
  shopSessions: ShopSessions;
  app: Injector;
  /** When given, ledger entries and assertion results are stored. */
  db?: Db;
}): Promise<ScenarioRunResult> {
  const { token } = shopSessions.createShopSession({
    scenarioRunId,
    faults: scenario.environment.faults,
    slots: Object.fromEntries(
      scenario.environment.slots.map((s) => [s.id, s.seed_text]),
    ),
    rail,
    sink,
  });
  let steps = 0;
  const tools = buildTools(scenario, token, app, (tool, args, result) => {
    steps++;
    sink.append({
      scenarioRunId,
      type: "agent.step",
      payload: { tool, args, result },
    });
  });

  let stats: AgentRunStats = {
    termination: "finished",
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  let error: string | undefined;
  try {
    const s = await agent.run(tools);
    stats = s ?? { ...stats, steps };
    error = s?.error;
  } catch (e) {
    // A thrown agent is an infrastructure failure; a runaway agent returns stats instead (5.4).
    error = errorText(e);
    stats = { ...stats, termination: "error", steps, error };
  } finally {
    shopSessions.end(token);
  }

  const audit = await runScenarioAudit({
    scenario,
    events: sink.for(scenarioRunId),
    rail,
    catalog: CATEGORY_BY_SKU,
  });
  if (error !== undefined) audit.verdict = "ERROR";

  sink.append({
    scenarioRunId,
    type: "ledger.snapshot",
    payload: { snapshot: audit.snapshot },
  });
  for (const r of audit.results)
    sink.append({ scenarioRunId, type: "assertion.result", payload: r });

  if (db) {
    for (const o of audit.snapshot.orders)
      upsertLedgerEntries(db, scenarioRunId, o);
    db.transaction(() => {
      db.prepare("DELETE FROM assertion_results WHERE scenario_run_id = ?").run(
        scenarioRunId,
      );
      for (const r of audit.results)
        insertAssertionResult(db, scenarioRunId, {
          assertion_type: r.type,
          category: r.category,
          severity: scenario.severity,
          passed: r.passed,
          expected: r.expected,
          actual: r.actual,
          evidence: r.evidence,
        });
    })();
  }
  return { audit, stats, ...(error !== undefined && { error }) };
}

/** The Shop tools over `app.inject`, plus the simulated user's two runtime tools. */
function buildTools(
  scenario: Scenario,
  token: string,
  app: Injector,
  step: (tool: string, args: Body, result: unknown) => void,
): Tools {
  const user = simulatedUser(scenario);
  const http = async (
    tool: string,
    args: Body,
    method: "GET" | "POST",
    url: string,
    payload?: Body,
  ): Promise<ToolResult> => {
    const res = await app.inject({
      method,
      url: `/shop/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload && { payload }),
    });
    const result = { status: res.statusCode, body: res.json<Body>() };
    step(tool, args, result);
    return result;
  };
  const enc = encodeURIComponent;
  return {
    search_products: (q) =>
      http("search_products", { q }, "GET", `/products?q=${enc(q)}`),
    get_product: (product_id) =>
      http(
        "get_product",
        { product_id },
        "GET",
        `/products/${enc(product_id)}`,
      ),
    view_cart: () => http("view_cart", {}, "GET", "/cart"),
    add_to_cart: (product_id, quantity) => {
      const args = { product_id, quantity };
      return http("add_to_cart", args, "POST", "/cart/items", args);
    },
    create_quote: (cart_id) =>
      http("create_quote", { cart_id }, "POST", "/checkout/quote", {
        cart_id,
      }),
    confirm_checkout: (quote_id, idempotency_key) => {
      const args = {
        quote_id,
        ...(idempotency_key !== undefined && { idempotency_key }),
      };
      return http("confirm_checkout", args, "POST", "/checkout/confirm", args);
    },
    list_orders: () => http("list_orders", {}, "GET", "/orders"),
    get_order: (order_id) =>
      http("get_order", { order_id }, "GET", `/orders/${enc(order_id)}`),
    refund_order: (order_id, amount, reason) =>
      http(
        "refund_order",
        { order_id, amount, reason },
        "POST",
        `/orders/${enc(order_id)}/refund`,
        { amount, reason },
      ),
    ask_user: (question) => {
      const { answer } = user.askUser(question);
      step("ask_user", { question }, { answer });
      return answer;
    },
    request_approval: (amount) => {
      const { approved } = user.requestApproval(fromPayPalValue(amount, "USD"));
      step("request_approval", { amount }, { approved });
      return approved;
    },
  };
}
