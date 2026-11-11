import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChargeRequest, Money } from "@crash-test/shared";
import type { Rail } from "./Rail.js";

const usd = (minor: number): Money => ({ minor, currency: "USD" });

/** Behavior every Rail must have. Run against MockRail always, and the sandbox rail behind SANDBOX_TESTS=1. */
export function railContract(makeRail: () => Rail | Promise<Rail>): void {
  const chargeReq = (): ChargeRequest => ({
    scenarioRunId: `run-${randomUUID()}`,
    requestId: randomUUID(),
    items: [
      {
        name: "USB-C Cable 1 m",
        sku: "p_cable_basic",
        quantity: 1,
        unitAmount: usd(999),
      },
    ],
    fees: [{ label: "handling", amount: usd(750) }],
    total: usd(1749),
    description: "Crash Test sandbox purchase",
  });

  describe("Rail contract", () => {
    it("preflight reports health", async () => {
      expect((await (await makeRail()).preflight()).ok).toBe(true);
    });

    it("charge completes an order whose capture matches the total", async () => {
      const rail = await makeRail();
      const req = chargeReq();
      const res = await rail.charge(req);
      const order = await rail.getOrder(res.orderId);
      expect(order.id).toBe(res.orderId);
      expect(order.customId).toBe(req.scenarioRunId);
      expect(order.captures).toHaveLength(1);
      expect(order.captures[0]).toMatchObject({
        status: "COMPLETED",
        amount: req.total,
      });
    });

    it("same requestId replays the original; no second order or capture", async () => {
      const rail = await makeRail();
      const req = chargeReq();
      const first = await rail.charge(req);
      const second = await rail.charge(req);
      expect(second).toEqual(first);
      expect((await rail.getOrder(first.orderId)).captures).toHaveLength(1);
      expect(await rail.recoverByRequestId(req)).toEqual(first);
    });

    it("a different requestId creates a new order", async () => {
      const rail = await makeRail();
      const a = await rail.charge(chargeReq());
      const b = await rail.charge(chargeReq());
      expect(b.orderId).not.toBe(a.orderId);
      for (const id of [a.orderId, b.orderId]) {
        expect((await rail.getOrder(id)).captures).toHaveLength(1);
      }
    });

    it("same requestId with a different body returns the original result", async () => {
      const rail = await makeRail();
      const req = chargeReq();
      const first = await rail.charge(req);
      const again = await rail.charge({
        ...req,
        items: req.items.map((i) => ({ ...i, quantity: i.quantity + 1 })),
        total: usd(req.total.minor * 2),
      });
      expect(again).toEqual(first);
      expect((await rail.getOrder(first.orderId)).captures).toHaveLength(1);
    });

    it("recoverByRequestId returns null for an unknown request", async () => {
      expect(
        await (await makeRail()).recoverByRequestId(chargeReq()),
      ).toBeNull();
    });

    it("refunds partially then fully", async () => {
      const rail = await makeRail();
      const { orderId, captureId } = await rail.charge(chargeReq());
      if (!captureId) throw new Error("charge returned no captureId");
      const partial = await rail.refund({
        requestId: randomUUID(),
        captureId,
        amount: usd(900),
        reason: "partial",
      });
      expect(partial.amount).toEqual(usd(900));
      const full = await rail.refund({ requestId: randomUUID(), captureId });
      expect(full.amount).toEqual(usd(849));
      const refunds = (await rail.getOrder(orderId)).captures[0]?.refunds ?? [];
      expect(refunds.map((r) => r.amount.minor)).toEqual([900, 849]);
    });

    it("refuses to refund more than captured", async () => {
      const rail = await makeRail();
      const { orderId, captureId } = await rail.charge(chargeReq());
      if (!captureId) throw new Error("charge returned no captureId");
      await expect(
        rail.refund({ requestId: randomUUID(), captureId, amount: usd(1750) }),
      ).rejects.toMatchObject({ code: "refund_exceeds_captured" });
      expect((await rail.getOrder(orderId)).captures[0]?.refunds).toHaveLength(
        0,
      );
      await rail.refund({ requestId: randomUUID(), captureId });
      await expect(
        rail.refund({ requestId: randomUUID(), captureId, amount: usd(1) }),
      ).rejects.toMatchObject({ code: "refund_exceeds_captured" });
      const refunds = (await rail.getOrder(orderId)).captures[0]?.refunds ?? [];
      expect(refunds.reduce((n, r) => n + r.amount.minor, 0)).toBe(1749);
    });

    it("same refund requestId does not refund twice", async () => {
      const rail = await makeRail();
      const { orderId, captureId } = await rail.charge(chargeReq());
      if (!captureId) throw new Error("charge returned no captureId");
      const req = { requestId: randomUUID(), captureId, amount: usd(500) };
      const first = await rail.refund(req);
      expect(await rail.refund(req)).toEqual(first);
      expect((await rail.getOrder(orderId)).captures[0]?.refunds).toHaveLength(
        1,
      );
    });
  });
}
