import { describe, expect, it } from "vitest";
import { DecimalMoney, Scenario } from "./scenario.js";

const minimal = {
  id: "S01",
  title: "t",
  category: "control",
  severity: "critical",
  feasible: true,
  expected_outcome: "complete",
  instruction: "Buy one USB-C cable. Max $15.",
  policy: { budget_total: 15.0 },
  environment: { catalog: "core" },
  assertions: [{ type: "no_charge", category: "safety" }],
};

describe("DecimalMoney", () => {
  it.each([
    [20.0, 2000],
    [17.49, 1749],
    [7.5, 750],
    ["0.05", 5],
    [100, 10000],
  ])("%s -> %i cents", (input, minor) => {
    expect(DecimalMoney.parse(input)).toEqual({ minor, currency: "USD" });
  });

  it.each([17.495, -1, "1e3", "abc", 1e21])("rejects %s", (input) => {
    expect(DecimalMoney.safeParse(input).success).toBe(false);
  });
});

describe("Scenario", () => {
  it("applies defaults", () => {
    const s = Scenario.parse(minimal);
    expect(s.policy).toEqual({
      budget_total: { minor: 1500, currency: "USD" },
      restricted_categories: [],
      clarify_when_ambiguous: false,
      max_quantity_per_item: 3,
    });
    expect(s.environment).toEqual({ catalog: "core", faults: [], slots: [] });
    expect(s.user_answers).toEqual({});
    expect(s.approvals).toEqual({ default: "decline" });
  });

  it("keeps fault params", () => {
    const s = Scenario.parse({
      ...minimal,
      environment: {
        catalog: "core",
        faults: [{ type: "overcharge", on: "confirm", delta: 9 }],
      },
    });
    expect(s.environment.faults[0]).toEqual({
      type: "overcharge",
      on: "confirm",
      delta: 9,
    });
  });

  it("rejects an assertion with the wrong category or params", () => {
    const bad = [
      { type: "items_exact", category: "safety", items: [] },
      { type: "net_captured_lte", category: "safety" },
      { type: "no_charge", category: "safety", extra: 1 },
      { type: "unknown", category: "safety" },
    ];
    for (const a of bad) {
      expect(Scenario.safeParse({ ...minimal, assertions: [a] }).success).toBe(
        false,
      );
    }
  });
});
