import {
  add,
  compare,
  sub,
  ChargeRequest,
  type ChargeResult,
  type Money,
  type RailCapture,
  type RailOrder,
  type RefundRequest,
  type RefundResult,
} from "@crash-test/shared";
import { RailError, type Rail, type RailHealth } from "./Rail.js";

/** Deterministic in-memory rail with PayPal-like idempotency. Tests, CI and keyless dev only. */
export class MockRail implements Rail {
  readonly kind = "mock" as const;
  private readonly orders = new Map<string, RailOrder>();
  private readonly charges = new Map<string, ChargeResult>();
  private readonly refunds = new Map<string, RefundResult>();
  private n = 0;

  preflight(): Promise<RailHealth> {
    return Promise.resolve({ ok: true, checks: [{ name: "mock", ok: true }] });
  }

  charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!ChargeRequest.safeParse(req).success)
      return Promise.reject(
        new RailError("invalid_request", "bad charge request"),
      );
    const replay = this.charges.get(req.requestId);
    if (replay) return Promise.resolve({ ...replay });

    // PayPal requires amount.value to equal the breakdown sum.
    let sum: Money = { minor: 0, currency: req.total.currency };
    for (const i of req.items) {
      sum = add(sum, {
        minor: i.unitAmount.minor * i.quantity,
        currency: i.unitAmount.currency,
      });
    }
    for (const f of req.fees) sum = add(sum, f.amount);
    if (compare(sum, req.total) !== 0) {
      return Promise.reject(
        new RailError(
          "invalid_request",
          "total does not equal items plus fees",
        ),
      );
    }

    const id = ++this.n;
    const result: ChargeResult = {
      orderId: `MOCK-ORDER-${id}`,
      status: "COMPLETED",
      captureId: `MOCK-CAPTURE-${id}`,
    };
    this.orders.set(result.orderId, {
      id: result.orderId,
      status: "COMPLETED",
      customId: req.scenarioRunId,
      items: structuredClone(req.items),
      captures: [
        {
          id: `MOCK-CAPTURE-${id}`,
          status: "COMPLETED",
          amount: { ...req.total },
          refunds: [],
        },
      ],
    });
    this.charges.set(req.requestId, result);
    return Promise.resolve({ ...result });
  }

  refund(req: RefundRequest): Promise<RefundResult> {
    const replay = this.refunds.get(req.requestId);
    if (replay) return Promise.resolve({ ...replay });

    const capture = this.findCapture(req.captureId);
    if (!capture)
      return Promise.reject(
        new RailError("not_found", `capture ${req.captureId}`),
      );

    let refunded: Money = { minor: 0, currency: capture.amount.currency };
    for (const r of capture.refunds) refunded = add(refunded, r.amount);
    const remaining = sub(capture.amount, refunded);
    const amount = req.amount ?? remaining;
    if (amount.minor <= 0 || compare(amount, remaining) > 0) {
      return Promise.reject(
        new RailError(
          "refund_exceeds_captured",
          "refund exceeds refundable amount",
        ),
      );
    }

    const result: RefundResult = {
      refundId: `MOCK-REFUND-${++this.n}`,
      status: "COMPLETED",
      amount,
    };
    capture.refunds.push({
      id: result.refundId,
      status: result.status,
      amount: { ...amount },
    });
    this.refunds.set(req.requestId, result);
    return Promise.resolve({ ...result });
  }

  getOrder(orderId: string): Promise<RailOrder> {
    const order = this.orders.get(orderId);
    if (!order)
      return Promise.reject(new RailError("not_found", `order ${orderId}`));
    return Promise.resolve(structuredClone(order));
  }

  recoverByRequestId(req: ChargeRequest): Promise<ChargeResult | null> {
    const found = this.charges.get(req.requestId);
    return Promise.resolve(found ? { ...found } : null);
  }

  private findCapture(captureId: string): RailCapture | undefined {
    for (const o of this.orders.values()) {
      const c = o.captures.find((x) => x.id === captureId);
      if (c) return c;
    }
    return undefined;
  }
}
