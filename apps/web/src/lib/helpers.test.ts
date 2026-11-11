import type { LedgerEntryDto, ScenarioRun } from "@crash-test/shared";
import { describe, expect, it } from "vitest";
import { buildMatrixRows, cellText } from "../grid/rows";
import {
  budgetFrom,
  formatMinor,
  formatValue,
  netCapturedMinor,
} from "./money";
import { chipFor } from "./verdict";

describe("chipFor", () => {
  it("maps verdicts and in-flight statuses to icon plus label", () => {
    expect(chipFor("UNSAFE", "done")).toMatchObject({
      label: "UNSAFE",
      icon: "✕",
      tone: "unsafe",
    });
    expect(chipFor("OVER_REFUSAL", "done").label).toBe("OVER-REFUSAL");
    expect(chipFor(null, "running").kind).toBe("RUNNING");
    expect(chipFor(null, "queued").kind).toBe("QUEUED");
    expect(chipFor(null, "error").kind).toBe("ERROR");
  });
});

describe("money display", () => {
  it("formats integer cents without floats", () => {
    expect(formatMinor(1749, "USD")).toBe("$17.49");
    expect(formatMinor(5, "USD")).toBe("$0.05");
    expect(formatMinor(-250, "USD")).toBe("-$2.50");
    expect(formatMinor(1000, "EUR")).toBe("10.00 EUR");
  });

  const entry = (e: Partial<LedgerEntryDto>): LedgerEntryDto => ({
    kind: "capture",
    paypal_id: "X",
    parent_paypal_id: null,
    amount_minor: 0,
    currency: "USD",
    status: "COMPLETED",
    ...e,
  });

  it("nets completed captures against completed refunds", () => {
    const ledger = [
      entry({ kind: "order", amount_minor: 9999 }),
      entry({ amount_minor: 2000 }),
      entry({ amount_minor: 2000, status: "PARTIALLY_REFUNDED" }),
      entry({ amount_minor: 700, status: "DECLINED" }),
      entry({ kind: "refund", amount_minor: 500 }),
      entry({ kind: "refund", amount_minor: 300, status: "PENDING" }),
    ];
    expect(netCapturedMinor(ledger)).toBe(3500);
  });

  it("reads the budget from net_captured_lte and renders Money in JSON", () => {
    const budget = { minor: 5000, currency: "USD" };
    expect(
      budgetFrom([
        { assertion_type: "net_captured_lte", expected: { lte: budget } },
      ]),
    ).toEqual(budget);
    expect(
      budgetFrom([{ assertion_type: "no_charge", expected: null }]),
    ).toBeNull();
    expect(formatValue({ lte: budget })).toContain('"$50.00"');
  });
});

describe("buildMatrixRows", () => {
  const sr = (
    id: string,
    scenario_id: string,
    profile_id: string,
    verdict: ScenarioRun["verdict"],
  ): ScenarioRun => ({
    id,
    run_id: "run_1",
    scenario_id,
    profile_id,
    trial: 1,
    status: verdict ? "done" : "running",
    verdict,
    safety_pass: null,
    task_pass: null,
    termination: null,
    steps: null,
    tokens_in: null,
    tokens_out: null,
    ledger_completeness: null,
    error: null,
    started_at: null,
    finished_at: null,
  });

  it("groups by scenario, one worst-of cell per profile with pass-rate", () => {
    const rows = buildMatrixRows(
      [
        sr("a", "S06", "naive", "PASS"),
        sr("b", "S06", "naive", "UNSAFE"),
        sr("c", "S06", "naive", "PASS"),
        sr("d", "S01", "hardened", null),
      ],
      [
        {
          id: "S06",
          title: "Retry",
          category: "retry",
          severity: "critical",
          feasible: true,
        },
      ],
    );
    expect(rows.map((r) => r.scenario_id)).toEqual(["S01", "S06"]);
    const cell = rows[1]?.cells.naive;
    expect(cell).toMatchObject({ scenarioRunId: "b", passed: 2, trials: 3 });
    expect(cellText(cell)).toBe("UNSAFE 2/3");
    expect(rows[1]?.severity).toBe("critical");
    expect(cellText(rows[0]?.cells.hardened)).toBe("RUNNING");
  });
});
