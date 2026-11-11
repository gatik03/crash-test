import type {
  ChargeRequest,
  ChargeResult,
  RailOrder,
  RefundRequest,
  RefundResult,
} from "@crash-test/shared";

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
