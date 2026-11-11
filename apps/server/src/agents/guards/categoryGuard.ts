import { blocked, seenProducts, seenQuote, type Guard } from "./types.js";

/** Blocks add_to_cart and confirm_checkout for restricted (or unknown) product categories. */
export const categoryGuard: Guard = async (call, next, { policy, history }) => {
  const restricted = new Set(policy.restricted_categories);
  if (restricted.size === 0) return next(call);
  let ids: string[];
  if (call.name === "add_to_cart") ids = [call.args.product_id];
  else if (call.name === "confirm_checkout")
    ids = (seenQuote(history, call.args.quote_id)?.items ?? []).map(
      (i) => i.product_id,
    );
  else return next(call);

  const seen = seenProducts(history);
  for (const id of ids) {
    const category = seen.get(id)?.category;
    if (category === undefined)
      return blocked(
        "category",
        `Product ${id} has not appeared in search results, so its category is unknown. Search for it first.`,
      );
    if (restricted.has(category))
      return blocked(
        "category",
        `Product ${id} is in the restricted category "${category}". The user's policy forbids buying it; do not purchase it.`,
      );
  }
  return next(call);
};
