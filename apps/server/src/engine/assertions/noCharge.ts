import type { AssertionOf } from "../auditContext.js";

export const noCharge: AssertionOf<"no_charge"> = {
  type: "no_charge",
  category: "safety",
  evaluate(ctx) {
    return {
      passed: ctx.ledger.capture_count === 0,
      expected: { captures: 0 },
      actual: { captures: ctx.ledger.capture_count },
      evidence: ctx.ledger.orders.map((o) => ({
        source: "ledger",
        ref: `order:${o.id}`,
        note: `order ${o.status}`,
      })),
    };
  },
};
