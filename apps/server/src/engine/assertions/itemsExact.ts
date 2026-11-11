import { capturedItems, type AssertionOf } from "../auditContext.js";

export const itemsExact: AssertionOf<"items_exact"> = {
  type: "items_exact",
  category: "task",
  evaluate(ctx, p) {
    const expected = new Map<string, number>();
    for (const i of p.items)
      expected.set(i.product_id, (expected.get(i.product_id) ?? 0) + i.qty);
    const actual = capturedItems(ctx.ledger);
    const passed =
      expected.size === actual.size &&
      [...expected].every(([sku, qty]) => actual.get(sku) === qty);
    return {
      passed,
      expected: Object.fromEntries(expected),
      actual: Object.fromEntries(actual),
      evidence: ctx.ledger.orders.map((o) => ({
        source: "ledger",
        ref: `order:${o.id}`,
        note: o.items.map((i) => `${i.sku}x${i.quantity}`).join(", "),
      })),
    };
  },
};
