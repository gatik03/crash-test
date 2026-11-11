import type { AppEvent, ChargeRequest } from "@crash-test/shared";
import { describe, expect, it } from "vitest";
import { MockRail } from "../rails/MockRail.js";
import { snapshotLedger } from "./ledger.js";

const usd = (minor: number) => ({ minor, currency: "USD" as const });
let seq = 0;
const ev = (type: string, payload: unknown) =>
  ({
    scenarioRunId: "sr1",
    seq: seq++,
    ts: "2026-11-12T00:00:00.000Z",
    type,
    payload,
  }) as AppEvent;

const req = (requestId: string, minor = 1800): ChargeRequest => ({
  scenarioRunId: "sr1",
  requestId,
  items: [
    {
      name: "USB Headset",
      sku: "p_headset",
      quantity: 1,
      unitAmount: usd(minor),
    },
  ],
  fees: [],
  total: usd(minor),
  description: "test",
});

describe("snapshotLedger", () => {
  it("reads results, recovers an intent without result, and nets refunds", async () => {
    const rail = new MockRail();
    const a = req("sr1:auto:1");
    const b = req("sr1:auto:2");
    const ra = await rail.charge(a);
    const rb = await rail.charge(b); // charged, but the result event was never written
    await rail.refund({
      requestId: "rf1",
      captureId: rb.captureId ?? "",
      amount: usd(500),
    });

    const { snapshot, orderIdsByRequestId } = await snapshotLedger({
      rail,
      events: [
        ev("rail.charge.intent", { requestId: a.requestId, request: a }),
        ev("rail.charge.result", { requestId: a.requestId, result: ra }),
        ev("rail.charge.intent", { requestId: b.requestId, request: b }),
        ev("rail.charge.error", { requestId: b.requestId, message: "timeout" }),
        ev("rail.charge.intent", { requestId: "never", request: req("never") }),
      ],
    });
    expect(orderIdsByRequestId).toEqual({
      [a.requestId]: ra.orderId,
      [b.requestId]: rb.orderId,
    });
    expect(snapshot.orders.map((o) => o.id)).toEqual([ra.orderId, rb.orderId]);
    expect(snapshot.capture_count).toBe(2);
    expect(snapshot.net_captured).toEqual(usd(1800 + 1800 - 500));
  });

  it("counts a fully refunded capture (live status REFUNDED) once", async () => {
    const rail = new MockRail();
    const a = req("x");
    const r = await rail.charge(a);
    const order = await rail.getOrder(r.orderId);
    const fake = {
      ...rail,
      recoverByRequestId: () => Promise.resolve(null),
      getOrder: () =>
        Promise.resolve({
          ...order,
          captures: order.captures.map((c) => ({
            ...c,
            status: "REFUNDED",
            refunds: [{ id: "R", status: "COMPLETED", amount: c.amount }],
          })),
        }),
    } as unknown as MockRail;
    const { snapshot } = await snapshotLedger({
      rail: fake,
      events: [ev("rail.charge.result", { requestId: "x", result: r })],
    });
    expect(snapshot.capture_count).toBe(1);
    expect(snapshot.net_captured).toEqual(usd(0));
  });
});
