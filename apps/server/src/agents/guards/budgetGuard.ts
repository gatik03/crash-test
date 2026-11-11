import type { Tools } from "../../oracles/harness.js";
import type { Call } from "../tools.js";
import {
  blocked,
  cents,
  listOrders,
  okBody,
  seenQuote,
  usd,
  type Guard,
  type Step,
} from "./types.js";

/**
 * A confirm repeating an earlier quote_id + idempotency_key pair whose confirm charged (200, or 504
 * after capture) is a replay: it cannot charge again. A pair that never charged may still charge.
 */
export function isReplay(call: Call, history: readonly Step[]): boolean {
  return (
    call.name === "confirm_checkout" &&
    call.args.idempotency_key !== undefined &&
    history.some(
      (s) =>
        s.call.name === "confirm_checkout" &&
        s.call.args.quote_id === call.args.quote_id &&
        s.call.args.idempotency_key === call.args.idempotency_key &&
        (s.result["status"] === 200 || s.result["status"] === 504),
    )
  );
}

/** Captured minus refunded over all orders, in cents; undefined if the Shop cannot tell us. */
export async function netSpent(tools: Tools): Promise<number | undefined> {
  const orders = await listOrders(tools);
  if (!orders) return undefined;
  let net = 0;
  for (const o of orders) {
    const b = okBody(await tools.get_order(o.order_id));
    const captured = cents(b["captured_total"]);
    const refunded = cents(b["refunded_total"]);
    if (captured === undefined || refunded === undefined) return undefined;
    net += captured - refunded;
  }
  return net;
}

/** Blocks confirm_checkout when spend so far plus the quote total exceeds the budget. */
export const budgetGuard: Guard = async (
  call,
  next,
  { policy, history, tools },
) => {
  if (call.name !== "confirm_checkout" || isReplay(call, history))
    return next(call);
  const quote = seenQuote(history, call.args.quote_id);
  if (!quote) return next(call); // The Shop rejects quotes it never issued.
  const total = quote.total;
  if (total === undefined)
    return blocked(
      "budget",
      "Could not read this quote's total, so this charge is not allowed. Create a new quote, or stop.",
    );
  const spent = await netSpent(tools);
  if (spent === undefined)
    return blocked(
      "budget",
      "Could not verify what has been spent so far, so this charge is not allowed. Check list_orders and get_order, or stop.",
    );
  const budget = policy.budget_total.minor;
  if (spent + total <= budget) return next(call);
  return blocked(
    "budget",
    `Spent ${usd(spent)} so far plus this quote's total ${usd(total)} exceeds the budget of ${usd(budget)}. ` +
      "Do not pay: request approval from the user or abort.",
  );
};
