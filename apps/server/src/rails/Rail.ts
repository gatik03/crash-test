import {
  add,
  compare,
  type ChargeRequest,
  type ChargeResult,
  type Money,
  type RailOrder,
  type RefundRequest,
  type RefundResult,
} from "@crash-test/shared";
import type { EventSink } from "../events/sink.js";

export type RailHealth = {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
};

export type RailErrorCode =
  "not_found" | "invalid_request" | "refund_exceeds_captured";

export class RailError extends Error {
  constructor(
    readonly code: RailErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RailError";
  }
}

export interface Rail {
  readonly kind: "paypal-sandbox" | "mock";
  /** Auth ok, wallet ok, probes. */
  preflight(): Promise<RailHealth>;
  /** Creates and completes an order with the wallet. The same requestId replays the original result. */
  charge(req: ChargeRequest): Promise<ChargeResult>;
  /** Full (amount omitted) or partial; never more than was captured. */
  refund(req: RefundRequest): Promise<RefundResult>;
  /** Ground truth: orders, captures, refunds. */
  getOrder(orderId: string): Promise<RailOrder>;
  /** Idempotent replay of a charge; null when no such request is known. */
  recoverByRequestId(req: ChargeRequest): Promise<ChargeResult | null>;
}

/** Item total and summed fees; `total` must equal their sum (PayPal rejects a mismatch). */
export function chargeBreakdown(req: ChargeRequest): {
  itemTotal: Money;
  fees: Money;
} {
  const zero: Money = { minor: 0, currency: req.total.currency };
  let itemTotal = zero;
  for (const i of req.items) {
    itemTotal = add(itemTotal, {
      minor: i.unitAmount.minor * i.quantity,
      currency: i.unitAmount.currency,
    });
  }
  let fees = zero;
  for (const f of req.fees) fees = add(fees, f.amount);
  if (compare(add(itemTotal, fees), req.total) !== 0)
    throw new RailError(
      "invalid_request",
      "total does not equal items plus fees",
    );
  return { itemTotal, fees };
}

/** Write-ahead log (ARCHITECTURE 5.2): intent before the call, result or error after it. */
export async function loggedCharge(
  sink: EventSink | undefined,
  req: ChargeRequest,
  call: () => Promise<ChargeResult>,
): Promise<ChargeResult> {
  const base = { scenarioRunId: req.scenarioRunId };
  const { requestId } = req;
  sink?.append({
    ...base,
    type: "rail.charge.intent",
    payload: { requestId, request: req },
  });
  try {
    const result = await call();
    sink?.append({
      ...base,
      type: "rail.charge.result",
      payload: { requestId, result },
    });
    return result;
  } catch (err) {
    sink?.append({
      ...base,
      type: "rail.charge.error",
      payload: {
        requestId,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
