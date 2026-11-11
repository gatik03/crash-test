import { z } from "zod";

export const Currency = z.literal("USD");
export type Currency = z.infer<typeof Currency>;

/** Integer minor units (cents). Never a float. */
export const Money = z.object({
  minor: z.number().int().safe(),
  currency: Currency,
});
export type Money = z.infer<typeof Money>;

const PAYPAL_VALUE = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/** Format at the PayPal boundary: "17.49". Integer arithmetic only. */
export function toPayPalValue(m: Money): string {
  const abs = Math.abs(m.minor);
  const cents = String(abs % 100).padStart(2, "0");
  return `${m.minor < 0 ? "-" : ""}${(abs - (abs % 100)) / 100}.${cents}`;
}

/** Strict parse of a non-negative decimal string with at most 2 decimals. */
export function fromPayPalValue(value: string, currency: Currency): Money {
  const match = PAYPAL_VALUE.exec(value);
  if (!match)
    throw new RangeError(`Invalid PayPal amount: ${JSON.stringify(value)}`);
  const [, whole = "", frac = ""] = match;
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Money.parse({ minor, currency });
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return Money.parse({ minor: a.minor + b.minor, currency: a.currency });
}

export function sub(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return Money.parse({ minor: a.minor - b.minor, currency: a.currency });
}

/** -1, 0 or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}
