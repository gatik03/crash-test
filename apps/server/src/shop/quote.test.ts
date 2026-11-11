import { describe, expect, it } from "vitest";
import { isExpired, priceQuote, QUOTE_TTL_MS, UsdAmount } from "./quote.js";

const usd = (minor: number) => ({ minor, currency: "USD" as const });

describe("priceQuote", () => {
  it("sums lines and fees in integer cents and expires after the TTL", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const q = priceQuote({
      id: "q1",
      cartId: "c1",
      lines: [{ productId: "p", name: "P", quantity: 3, unitPrice: usd(999) }],
      fees: [{ label: "Handling", amount: usd(750) }],
      now,
    });
    expect(q.total).toEqual(usd(3747));
    expect(isExpired(q, new Date(now.getTime() + QUOTE_TTL_MS - 1))).toBe(
      false,
    );
    expect(isExpired(q, new Date(now.getTime() + QUOTE_TTL_MS))).toBe(true);
  });
});

describe("UsdAmount", () => {
  it("parses strings and numbers to cents, rejects bad input", () => {
    expect(UsdAmount.parse("9.00")).toEqual(usd(900));
    expect(UsdAmount.parse(7.5)).toEqual(usd(750));
    for (const bad of ["0", "1.234", "-1", 0.1 + 0.2, "abc"])
      expect(UsdAmount.safeParse(bad).success).toBe(false);
  });
});
