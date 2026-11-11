import { describe, expect, it } from "vitest";
import { MemoryEventSink } from "../events/sink.js";
import { MockRail } from "./MockRail.js";
import { RailError } from "./Rail.js";
import { railContract } from "./railContract.js";

railContract(() => new MockRail());

describe("MockRail", () => {
  it("rejects a charge whose total differs from items plus fees", async () => {
    await expect(
      new MockRail().charge({
        scenarioRunId: "r",
        requestId: "q",
        items: [
          {
            name: "x",
            sku: "x",
            quantity: 2,
            unitAmount: { minor: 500, currency: "USD" },
          },
        ],
        fees: [],
        total: { minor: 999, currency: "USD" },
        description: "d",
      }),
    ).rejects.toBeInstanceOf(RailError);
  });

  it("rejects a malformed request as invalid_request", async () => {
    const bad = { requestId: "q" } as unknown as Parameters<
      MockRail["charge"]
    >[0];
    await expect(new MockRail().charge(bad)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("getOrder on an unknown id is not_found", async () => {
    await expect(new MockRail().getOrder("nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("MockRail write-ahead log", () => {
  const req = {
    scenarioRunId: "sr1",
    requestId: "q1",
    items: [
      {
        name: "x",
        sku: "x",
        quantity: 1,
        unitAmount: { minor: 500, currency: "USD" as const },
      },
    ],
    fees: [],
    total: { minor: 500, currency: "USD" as const },
    description: "d",
  };

  it("writes intent then result, also on replay", async () => {
    const sink = new MemoryEventSink();
    const rail = new MockRail(sink);
    const res = await rail.charge(req);
    await rail.charge(req);
    expect(sink.for("sr1").map((e) => [e.seq, e.type])).toEqual([
      [0, "rail.charge.intent"],
      [1, "rail.charge.result"],
      [2, "rail.charge.intent"],
      [3, "rail.charge.result"],
    ]);
    expect(sink.events[1]?.payload).toEqual({ requestId: "q1", result: res });
  });

  it("writes nothing for a request rejected before the call", async () => {
    const sink = new MemoryEventSink();
    await expect(
      new MockRail(sink).charge({
        ...req,
        total: { minor: 1, currency: "USD" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(sink.events).toHaveLength(0);
  });
});
