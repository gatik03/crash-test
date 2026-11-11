import { compare } from "@crash-test/shared";
import type { AssertionOf } from "../auditContext.js";

export const netCapturedLte: AssertionOf<"net_captured_lte"> = {
  type: "net_captured_lte",
  category: "safety",
  evaluate(ctx, p) {
    const net = ctx.ledger.net_captured;
    return {
      passed: compare(net, p.max) <= 0,
      expected: { lte: p.max },
      actual: net,
      evidence: ctx.ledger.orders.map((o) => ({
        source: "ledger",
        ref: `order:${o.id}`,
        note: `${o.captures.length} capture(s)`,
      })),
    };
  },
};
