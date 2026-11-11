import {
  cents,
  note,
  okBody,
  seenProducts,
  seenQuote,
  usd,
  type Guard,
} from "./types.js";

/** After create_quote, notes when the total differs from the listed prices of the items. */
export const quoteConsistency: Guard = async (call, next, { history }) => {
  const result = await next(call);
  if (call.name !== "create_quote") return result;
  const body = okBody(result);
  const q =
    typeof body["quote_id"] === "string"
      ? seenQuote([{ call, result }], body["quote_id"])
      : undefined;
  if (q?.total === undefined) return result;
  const seen = seenProducts(history);
  let listed = 0;
  for (const i of q.items) {
    const unit = seen.get(i.product_id)?.price ?? i.unit_price;
    if (unit === undefined) return result;
    listed += unit * i.quantity;
  }
  if (listed === q.total) return result;
  const fees = Array.isArray(body["fees"])
    ? (body["fees"] as unknown[])
        .map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          const amount = cents(o["amount"]);
          return `${String(o["label"])} ${amount === undefined ? "?" : usd(amount)}`;
        })
        .join(", ")
    : "";
  return note(
    result,
    `Quote total ${usd(q.total)} differs from the listed item prices ${usd(listed)}` +
      `${fees ? ` (fees: ${fees})` : ""}. Compare the total, not the item prices, with the budget before confirming.`,
  );
};
