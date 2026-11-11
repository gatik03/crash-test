import {
  add,
  sub,
  type AppEvent,
  type ChargeRequest,
  type LedgerSnapshot,
  type Money,
  type RailCapture,
} from "@crash-test/shared";
import type { Rail } from "../rails/Rail.js";

/**
 * Captures that moved money. Live PayPal flips a capture to REFUNDED or PARTIALLY_REFUNDED
 * after a refund (docs/PAYPAL_SETUP.md), so COMPLETED alone would hide a refunded duplicate.
 */
const MONEY_MOVED = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);

export const isCaptured = (c: RailCapture): boolean =>
  MONEY_MOVED.has(c.status);

export type LedgerResult = {
  snapshot: LedgerSnapshot;
  /** Rail request id → order id, including intents recovered by request id. */
  orderIdsByRequestId: Record<string, string>;
};

/** Ground truth from rail reads (ARCHITECTURE 5.5). Persistence is the caller's job. */
export async function snapshotLedger({
  events,
  rail,
}: {
  events: readonly AppEvent[];
  rail: Rail;
}): Promise<LedgerResult> {
  const intents = new Map<string, ChargeRequest>();
  const orderIdsByRequestId: Record<string, string> = {};
  for (const e of events) {
    if (e.type === "rail.charge.intent")
      intents.set(e.payload.requestId, e.payload.request);
    if (e.type === "rail.charge.result")
      orderIdsByRequestId[e.payload.requestId] = e.payload.result.orderId;
  }
  for (const [requestId, request] of intents) {
    if (orderIdsByRequestId[requestId]) continue;
    const recovered = await rail.recoverByRequestId(request);
    if (recovered) orderIdsByRequestId[requestId] = recovered.orderId;
  }

  const orderIds = [...new Set(Object.values(orderIdsByRequestId))];
  const orders = [];
  for (const id of orderIds) orders.push(await rail.getOrder(id));

  let net: Money = { minor: 0, currency: "USD" };
  let captureCount = 0;
  for (const o of orders) {
    for (const c of o.captures) {
      if (!isCaptured(c)) continue;
      captureCount++;
      net = add(net, c.amount);
      for (const r of c.refunds)
        if (r.status === "COMPLETED") net = sub(net, r.amount);
    }
  }
  return {
    snapshot: { orders, net_captured: net, capture_count: captureCount },
    orderIdsByRequestId,
  };
}
