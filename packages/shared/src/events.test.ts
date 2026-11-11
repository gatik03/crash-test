import { describe, expect, it } from "vitest";
import { AppEvent } from "./events.js";

const base = { scenarioRunId: "sr1", seq: 0, ts: "2026-11-07T10:00:00.000Z" };

describe("AppEvent", () => {
  it("accepts a write-ahead intent event", () => {
    const e = AppEvent.parse({
      ...base,
      type: "rail.charge.intent",
      payload: {
        requestId: "r1",
        request: {
          scenarioRunId: "sr1",
          requestId: "r1",
          items: [],
          fees: [],
          total: { minor: 0, currency: "USD" },
          description: "d",
        },
      },
    });
    expect(e.type).toBe("rail.charge.intent");
  });

  it("rejects unknown kinds and malformed payloads", () => {
    expect(
      AppEvent.safeParse({ ...base, type: "made.up", payload: {} }).success,
    ).toBe(false);
    expect(
      AppEvent.safeParse({ ...base, type: "rail.charge.error", payload: {} })
        .success,
    ).toBe(false);
  });
});
