import {
  fromPayPalValue,
  toPayPalValue,
  type Policy,
} from "@crash-test/shared";
import type { Tools } from "../../oracles/harness.js";
import type { Call, Exec, Outcome } from "../tools.js";

/** One executed agent tool call and its raw result. */
export type Step = { call: Call; result: Outcome };

/** All a guard may read: what a legitimate agent knows (AGENTS rule 5). */
export type GuardCtx = {
  policy: Policy;
  instruction: string;
  history: readonly Step[];
  /** Unguarded tools, for read-only verification calls. */
  tools: Tools;
};

export type Guard = (call: Call, next: Exec, ctx: GuardCtx) => Promise<Outcome>;

export const blocked = (guard: string, message: string): Outcome => ({
  error: { code: "blocked_by_guard", guard, message },
});

export function note(o: Outcome, text: string): Outcome {
  const prev = Array.isArray(o["guard_notes"]) ? o["guard_notes"] : [];
  return { ...o, guard_notes: [...prev, text] };
}

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(obj) : [];

/** Body of a 2xx Shop result, else `{}`. */
export function okBody(o: Outcome): Record<string, unknown> {
  const s = o["status"];
  return typeof s === "number" && s >= 200 && s < 300 ? obj(o["body"]) : {};
}

/** Cents of a "18.00" string; undefined when absent or malformed. */
export function cents(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  try {
    return fromPayPalValue(v, "USD").minor;
  } catch {
    return undefined;
  }
}

export type SeenProduct = { id: string; category?: string; price?: number };

/** Products the agent has seen in search results, by id. */
export function seenProducts(
  history: readonly Step[],
): Map<string, SeenProduct> {
  const seen = new Map<string, SeenProduct>();
  for (const s of history) {
    if (s.call.name !== "search_products") continue;
    for (const p of arr(okBody(s.result)["products"])) {
      if (typeof p["id"] !== "string") continue;
      const price = cents(p["price"]);
      seen.set(p["id"], {
        id: p["id"],
        ...(typeof p["category"] === "string" && { category: p["category"] }),
        ...(price !== undefined && { price }),
      });
    }
  }
  return seen;
}

export type SeenQuote = {
  total?: number;
  items: { product_id: string; quantity: number; unit_price?: number }[];
};

/** The quote with this id from create_quote results. */
export function seenQuote(
  history: readonly Step[],
  quoteId: string,
): SeenQuote | undefined {
  for (const s of history) {
    if (s.call.name !== "create_quote") continue;
    const b = okBody(s.result);
    if (b["quote_id"] !== quoteId) continue;
    const total = cents(b["total"]);
    return {
      ...(total !== undefined && { total }),
      items: arr(b["items"]).flatMap((i) => {
        const unit = cents(i["unit_price"]);
        return typeof i["product_id"] === "string" &&
          typeof i["quantity"] === "number"
          ? [
              {
                product_id: i["product_id"],
                quantity: i["quantity"],
                ...(unit !== undefined && { unit_price: unit }),
              },
            ]
          : [];
      }),
    };
  }
  return undefined;
}

/** "18.00", the Shop's amount format. */
export const amount = (minor: number) =>
  toPayPalValue({ minor, currency: "USD" });
export const usd = (minor: number) => `$${amount(minor)}`;

/** Orders listed by the Shop, read through the unguarded tools. */
export async function listOrders(
  tools: Tools,
): Promise<{ order_id: string; quote_id?: string }[] | undefined> {
  const r = await tools.list_orders();
  if (r.status !== 200) return undefined;
  return arr(r.body["orders"]).flatMap((o) =>
    typeof o["order_id"] === "string"
      ? [
          {
            order_id: o["order_id"],
            ...(typeof o["quote_id"] === "string" && {
              quote_id: o["quote_id"],
            }),
          },
        ]
      : [],
  );
}
