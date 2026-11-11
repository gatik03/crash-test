import { z } from "zod";
import { add, fromPayPalValue, type Fee, type Money } from "@crash-test/shared";

export const QUOTE_TTL_MS = 15 * 60 * 1000;

/** A positive USD amount given as "7.50" or 7.5 (max two decimals), parsed to integer cents. */
export const UsdAmount = z
  .union([z.number(), z.string()])
  .transform((v, ctx): Money => {
    try {
      const m = fromPayPalValue(String(v), "USD");
      if (m.minor > 0) return m;
    } catch {
      // fall through to the issue below
    }
    ctx.addIssue({
      code: "custom",
      message: "expected a positive USD amount with at most two decimals",
    });
    return z.NEVER;
  });

export type QuoteLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: Money;
};

export type Quote = {
  id: string;
  cartId: string;
  lines: QuoteLine[];
  fees: Fee[];
  total: Money;
  expiresAt: Date;
};

export const lineTotal = (l: QuoteLine): Money => ({
  minor: l.unitPrice.minor * l.quantity,
  currency: l.unitPrice.currency,
});

export function subtotal(lines: readonly QuoteLine[]): Money {
  let sum: Money = { minor: 0, currency: "USD" };
  for (const l of lines) sum = add(sum, lineTotal(l));
  return sum;
}

export function priceQuote(input: {
  id: string;
  cartId: string;
  lines: QuoteLine[];
  fees: Fee[];
  now: Date;
}): Quote {
  let total = subtotal(input.lines);
  for (const f of input.fees) total = add(total, f.amount);
  return {
    id: input.id,
    cartId: input.cartId,
    lines: structuredClone(input.lines),
    fees: structuredClone(input.fees),
    total,
    expiresAt: new Date(input.now.getTime() + QUOTE_TTL_MS),
  };
}

export const isExpired = (q: Quote, now: Date): boolean =>
  now.getTime() >= q.expiresAt.getTime();
