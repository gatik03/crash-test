import { describe, expect, it } from "vitest";
import {
  Money,
  add,
  compare,
  equals,
  fromPayPalValue,
  sub,
  toPayPalValue,
  type Money as MoneyT,
} from "./money.js";

const usd = (minor: number): MoneyT => ({ minor, currency: "USD" });

describe("toPayPalValue", () => {
  it.each([
    [1749, "17.49"],
    [5, "0.05"],
    [0, "0.00"],
    [100, "1.00"],
    [123456789, "1234567.89"],
  ])("%i -> %s", (minor, text) => expect(toPayPalValue(usd(minor))).toBe(text));
});

describe("fromPayPalValue", () => {
  it.each(["17.49", "0.05", "0.00", "100.00", "1234567.89", "7", "7.5"])(
    "round-trips %s",
    (text) => {
      const m = fromPayPalValue(text, "USD");
      expect(fromPayPalValue(toPayPalValue(m), "USD")).toEqual(m);
    },
  );

  it('treats "0.1" and "0.10" as 10 minor units', () => {
    expect(fromPayPalValue("0.1", "USD").minor).toBe(10);
    expect(fromPayPalValue("0.10", "USD").minor).toBe(10);
  });

  it("rejects leading zeros", () => {
    expect(() => fromPayPalValue("007.50", "USD")).toThrow(RangeError);
  });

  it("parses 7.5 as 750 minor units", () => {
    expect(fromPayPalValue("7.5", "USD").minor).toBe(750);
  });

  it.each([
    "1.234",
    "abc",
    "-1.00",
    "",
    ".5",
    "1.",
    "1e3",
    " 1.00",
    "1,00",
    "0x10",
    "9".repeat(20),
  ])("rejects %j", (text) =>
    expect(() => fromPayPalValue(text, "USD")).toThrow(),
  );
});

describe("arithmetic", () => {
  it("0.1 + 0.2 is exactly 0.30", () => {
    const sum = add(
      fromPayPalValue("0.10", "USD"),
      fromPayPalValue("0.20", "USD"),
    );
    expect(toPayPalValue(sum)).toBe("0.30");
    expect(equals(sum, fromPayPalValue("0.30", "USD"))).toBe(true);
  });

  it("19.99 - 0.01 is exact", () => {
    expect(toPayPalValue(sub(usd(1999), usd(1)))).toBe("19.98");
  });

  it("compare orders amounts", () => {
    expect(compare(usd(1), usd(2))).toBe(-1);
    expect(compare(usd(2), usd(2))).toBe(0);
    expect(compare(usd(3), usd(2))).toBe(1);
  });

  it("rejects a currency mismatch", () => {
    const eur = { minor: 1, currency: "EUR" } as unknown as MoneyT;
    expect(() => add(usd(1), eur)).toThrow(/mismatch/i);
    expect(() => compare(usd(1), eur)).toThrow(/mismatch/i);
  });

  it("rejects results outside the safe integer range", () => {
    expect(() => add(usd(Number.MAX_SAFE_INTEGER), usd(1))).toThrow();
  });
});

describe("Money schema", () => {
  it("rejects fractional minor units and other currencies", () => {
    expect(Money.safeParse({ minor: 1.5, currency: "USD" }).success).toBe(
      false,
    );
    expect(Money.safeParse({ minor: 1, currency: "EUR" }).success).toBe(false);
  });
});
