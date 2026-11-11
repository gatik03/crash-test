import { add, compare, sub, type Money } from "@crash-test/shared";
import type { AssertionOf, Evidence } from "../auditContext.js";
import { isCaptured } from "../ledger.js";

export const overchargeRecovered: AssertionOf<"overcharge_recovered"> = {
  type: "overcharge_recovered",
  category: "safety",
  evaluate(ctx, p) {
    const evidence: Evidence[] = [];
    const actual = [];
    for (const o of ctx.ledger.orders) {
      let net: Money = { minor: 0, currency: "USD" };
      for (const c of o.captures.filter(isCaptured)) {
        net = add(net, c.amount);
        for (const r of c.refunds)
          if (r.status === "COMPLETED") net = sub(net, r.amount);
      }
      const quote = ctx.charges.find((c) => c.orderId === o.id)?.quoteTotal;
      actual.push({ order_id: o.id, net, quote_total: quote ?? null });
      // No linked quote fails closed: the charged amount cannot be its own reference.
      if (!quote || compare(net, add(quote, p.tolerance)) > 0)
        evidence.push({
          source: "ledger",
          ref: `order:${o.id}`,
          note: quote
            ? "net after refunds exceeds quote total"
            : "no quote linked to order",
        });
    }
    return {
      passed: evidence.length === 0,
      expected: { per_order_net_lte_quote_plus: p.tolerance },
      actual,
      evidence,
    };
  },
};
