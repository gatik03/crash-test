import { fromPayPalValue, type Scenario } from "@crash-test/shared";
import { buildApp } from "../app.js";
import { runScenarioAudit, type ScenarioAudit } from "../engine/runner.js";
import { MemoryEventSink } from "../events/sink.js";
import { MockRail } from "../rails/MockRail.js";
import { simulatedUser } from "../scenarios/simulatedUser.js";
import { CATEGORY_BY_SKU } from "../shop/catalog.js";
import { ShopSessions } from "../shop/session.js";

export type Body = Record<string, unknown>;
export type ToolResult = { status: number; body: Body };

/** The nine Shop tools of ARCHITECTURE 5.4 plus the two answered by the simulated user. */
export type Tools = {
  search_products(q: string): Promise<ToolResult>;
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
  const rail = new MockRail(sink);
  const sessions = new ShopSessions();
  const { token } = sessions.createShopSession({
    scenarioRunId,
    faults: scenario.environment.faults,
    slots: Object.fromEntries(
      scenario.environment.slots.map((s) => [s.id, s.seed_text]),
    ),
    rail,
    sink,
  });
  const app = buildApp({ logger: false, shopSessions: sessions });
  const user = simulatedUser(scenario);
  const step = (tool: string, args: Body, result: unknown) =>
    sink.append({
      scenarioRunId,
      type: "agent.step",
      payload: { tool, args, result },
    });
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
  const tools: Tools = {
    search_products: (q) =>
      http("search_products", { q }, "GET", `/products?q=${enc(q)}`),
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
  try {
    await script(tools);
  } finally {
    await app.close();
  }
  return runScenarioAudit({
    scenario,
    events: sink.for(scenarioRunId),
    rail,
    catalog: CATEGORY_BY_SKU,
  });
}
