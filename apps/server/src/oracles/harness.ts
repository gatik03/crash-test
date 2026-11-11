import { fromPayPalValue, type Scenario } from "@crash-test/shared";
import Fastify from "fastify";
import type { ScenarioAudit } from "../engine/runner.js";
import { runScenario } from "../engine/scenarioRun.js";
import { MemoryEventSink } from "../events/sink.js";
import { MockRail } from "../rails/MockRail.js";
import { shopRoutes } from "../shop/routes.js";
import { ShopSessions } from "../shop/session.js";

export type Body = Record<string, unknown>;
export type ToolResult = { status: number; body: Body };

/** The Shop tools of ARCHITECTURE 5.4 plus the two answered by the simulated user. */
export type Tools = {
  search_products(q: string): Promise<ToolResult>;
  get_product(product_id: string): Promise<ToolResult>;
  view_cart(): Promise<ToolResult>;
  add_to_cart(product_id: string, quantity: number): Promise<ToolResult>;
  create_quote(cart_id: string): Promise<ToolResult>;
  confirm_checkout(
    quote_id: string,
    idempotency_key?: string,
  ): Promise<ToolResult>;
  list_orders(): Promise<ToolResult>;
  get_order(order_id: string): Promise<ToolResult>;
  refund_order(
    order_id: string,
    amount: string,
    reason: string,
  ): Promise<ToolResult>;
  ask_user(question: string): string;
  request_approval(amount: string): boolean;
};

/** A scripted agent: no LLM, no network. */
export type Script = (t: Tools) => Promise<void>;
export type ScenarioScripts = { oracle: Script; saboteur: Script };

export function str(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== "string") throw new Error(`expected string ${key}`);
  return v;
}

/** Adds the items, then quotes the whole cart. */
export async function quote(
  t: Tools,
  items: Readonly<Record<string, number>>,
): Promise<{ quote_id: string; total: string }> {
  let cartId = "";
  for (const [id, qty] of Object.entries(items))
    cartId = str((await t.add_to_cart(id, qty)).body, "cart_id");
  const q = (await t.create_quote(cartId)).body;
  return { quote_id: str(q, "quote_id"), total: str(q, "total") };
}

export const cents = (v: string) => fromPayPalValue(v, "USD").minor;

/** Runs one scripted agent against a fresh Shop on MockRail, then audits the ledger. */
export async function runScripted(
  scenario: Scenario,
  script: Script,
  scenarioRunId: string,
): Promise<ScenarioAudit> {
  const sink = new MemoryEventSink();
  const shopSessions = new ShopSessions();
  // Shop only, not app.ts: app.ts reaches engine/profiles.ts, which imports these scripts.
  const app = Fastify({ logger: false });
  app.register(shopRoutes, { prefix: "/shop/v1", sessions: shopSessions });
  try {
    const { audit } = await runScenario({
      scenario,
      agent: { run: script },
      rail: new MockRail(sink),
      sink,
      scenarioRunId,
      shopSessions,
      app,
    });
    return audit;
  } finally {
    await app.close();
  }
}
