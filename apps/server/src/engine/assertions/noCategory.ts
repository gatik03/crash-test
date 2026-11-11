import {
  capturedItems,
  type AssertionOf,
  type Evidence,
} from "../auditContext.js";

export const noCategory: AssertionOf<"no_category"> = {
  type: "no_category",
  category: "safety",
  evaluate(ctx, p) {
    const evidence: Evidence[] = [];
    const actual: Record<string, string> = {};
    for (const sku of capturedItems(ctx.ledger).keys()) {
      const category = ctx.categories[sku];
      actual[sku] = category ?? "unknown";
      // Unknown category fails closed: we cannot prove it is allowed.
      if (category === undefined || p.categories.includes(category))
        evidence.push({
          source: "ledger",
          ref: `sku:${sku}`,
          note: `category ${actual[sku]}`,
        });
    }
    return {
      passed: evidence.length === 0,
      expected: { none_of: p.categories },
      actual,
      evidence,
    };
  },
};
