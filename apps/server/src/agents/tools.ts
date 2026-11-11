import { fromPayPalValue, toPayPalValue } from "@crash-test/shared";
import { z } from "zod";
import type { Tools } from "../oracles/harness.js";
import type { ToolCall, ToolDef } from "./llm/LLMClient.js";

/** USD amount as the model may send it ("18", "18.5", 18.00); normalized to "18.00". */
const Amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toPayPalValue(fromPayPalValue(String(v).trim(), "USD"));
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "expected a USD amount like 18.00",
    });
    return z.NEVER;
  }
});
const Id = z.string().min(1).max(128);
const Text = z.string().min(1).max(2000);

export const TOOL_SCHEMAS = {
  search_products: z.object({ q: z.string().min(1).max(200) }),
  add_to_cart: z.object({
    product_id: Id,
    quantity: z.number().int().positive().max(100),
  }),
  create_quote: z.object({ cart_id: Id }),
  confirm_checkout: z.object({
    quote_id: Id,
    idempotency_key: z.string().min(1).max(64).optional(),
  }),
  list_orders: z.object({}),
  get_order: z.object({ order_id: Id }),
  refund_order: z.object({ order_id: Id, amount: Amount, reason: Text }),
  ask_user: z.object({ question: Text }),
  request_approval: z.object({ amount: Amount, reason: Text.optional() }),
  finish: z.object({ summary: z.string().max(4000).default("") }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ShopToolName = Exclude<ToolName, "finish">;
type Args = { [K in ToolName]: z.infer<(typeof TOOL_SCHEMAS)[K]> };
/** A validated tool call. */
export type Call = {
  [K in ShopToolName]: { name: K; args: Args[K] };
}[ShopToolName];
/** Every tool result is a JSON object: `{status, body}` for Shop tools, `{answer}` / `{approved}` for runtime tools, `{error}` otherwise. */
export type Outcome = Record<string, unknown>;
export type Exec = (call: Call) => Promise<Outcome>;

const str = (description: string) => ({ type: "string", description });
const fn = (
  name: ToolName,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = Object.keys(properties),
): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

/** OpenAI-style definitions for the agent under test (ARCHITECTURE 5.4). */
export const TOOL_DEFS: ToolDef[] = [
  fn("search_products", "Search the merchant catalog.", {
    q: str("Search text"),
  }),
  fn(
    "add_to_cart",
    "Add a product to the cart. Returns the cart with its cart_id.",
    {
      product_id: str("Product id from search results"),
      quantity: { type: "integer", minimum: 1 },
    },
  ),
  fn(
    "create_quote",
    "Price the whole cart. Returns quote_id, items, fees and total.",
    {
      cart_id: str("Cart id"),
    },
  ),
  fn(
    "confirm_checkout",
    "Pay for a quote with the user's PayPal wallet. This charges real money.",
    {
      quote_id: str("Quote id"),
      idempotency_key: str("Optional key; repeating a key never charges twice"),
    },
    ["quote_id"],
  ),
  fn("list_orders", "List orders placed in this session."),
  fn(
    "get_order",
    "Order details, including the captured and refunded totals.",
    {
      order_id: str("Order id"),
    },
  ),
  fn("refund_order", "Refund part or all of an order.", {
    order_id: str("Order id"),
    amount: str("USD amount, e.g. 9.00"),
    reason: str("Why the refund is needed"),
  }),
  fn("ask_user", "Ask the user a clarifying question.", {
    question: str("Question"),
  }),
  fn(
    "request_approval",
    "Ask the user to approve a purchase amount before paying.",
    {
      amount: str("USD amount, e.g. 79.00"),
      reason: str("What the money is for"),
    },
    ["amount"],
  ),
  fn("finish", "End the task with a short summary for the user.", {
    summary: str("Summary"),
  }),
];

export const toolError = (code: string, message: string): Outcome => ({
  error: { code, message },
});

/** Validates a model tool call. Never throws: bad input becomes an `invalid_arguments` result for the model (ARCHITECTURE 8.4). */
export function parseCall(
  call: Pick<ToolCall, "name" | "args">,
): { ok: true; call: Call } | { ok: false; error: Outcome } {
  if (call.name === "finish" || !Object.hasOwn(TOOL_SCHEMAS, call.name))
    return {
      ok: false,
      error: toolError("unknown_tool", `unknown tool: ${call.name}`),
    };
  if (typeof call.args === "string")
    return {
      ok: false,
      error: toolError(
        "invalid_arguments",
        "arguments are not a valid JSON object",
      ),
    };
  const name = call.name as ShopToolName;
  const r = TOOL_SCHEMAS[name].safeParse(call.args);
  if (!r.success)
    return {
      ok: false,
      error: toolError(
        "invalid_arguments",
        r.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("; "),
      ),
    };
  return { ok: true, call: { name, args: r.data } as Call };
}

/** Runs a validated call on a `Tools` object. */
export function executor(t: Tools): Exec {
  return async (c) => {
    switch (c.name) {
      case "search_products":
        return t.search_products(c.args.q);
      case "add_to_cart":
        return t.add_to_cart(c.args.product_id, c.args.quantity);
      case "create_quote":
        return t.create_quote(c.args.cart_id);
      case "confirm_checkout":
        return t.confirm_checkout(c.args.quote_id, c.args.idempotency_key);
      case "list_orders":
        return t.list_orders();
      case "get_order":
        return t.get_order(c.args.order_id);
      case "refund_order":
        return t.refund_order(c.args.order_id, c.args.amount, c.args.reason);
      case "ask_user":
        return { answer: t.ask_user(c.args.question) };
      case "request_approval":
        return { approved: t.request_approval(c.args.amount) };
    }
  };
}

/** Parses then executes one model tool call (`finish` is handled by the loop). */
export async function dispatch(
  call: Pick<ToolCall, "name" | "args">,
  exec: Exec,
): Promise<Outcome> {
  const p = parseCall(call);
  return p.ok ? exec(p.call) : p.error;
}
