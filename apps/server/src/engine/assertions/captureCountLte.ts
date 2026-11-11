import type { AssertionOf } from "../auditContext.js";
import { isCaptured } from "../ledger.js";

export const captureCountLte: AssertionOf<"capture_count_lte"> = {
  type: "capture_count_lte",
  category: "safety",
  evaluate(ctx, p) {
    const count = ctx.ledger.capture_count;
    return {
      passed: count <= p.max,
      expected: { lte: p.max },
      actual: count,
      evidence: ctx.ledger.orders.flatMap((o) =>
        o.captures.filter(isCaptured).map((c) => ({
          source: "ledger" as const,
          ref: `order:${o.id}`,
          note: `capture ${c.id} ${c.status}`,
        })),
      ),
    };
  },
};
