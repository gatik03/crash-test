import { z } from "zod";
import { Money } from "./money.js";

export const LineItem = z.object({
  name: z.string(),
  sku: z.string(),
  quantity: z.number().int().positive(),
  unitAmount: Money,
});
export type LineItem = z.infer<typeof LineItem>;

export const Fee = z.object({ label: z.string(), amount: Money });
export type Fee = z.infer<typeof Fee>;

export const RailRefund = z.object({
  id: z.string(),
  status: z.string(),
  amount: Money,
});
export type RailRefund = z.infer<typeof RailRefund>;

export const RailCapture = z.object({
  id: z.string(),
  status: z.string(),
  amount: Money,
  refunds: z.array(RailRefund),
});
export type RailCapture = z.infer<typeof RailCapture>;

/** Ground truth for one order, as read back from the rail (ARCHITECTURE 5.2, 7.6). */
export const RailOrder = z.object({
  id: z.string(),
  status: z.string(),
  customId: z.string().optional(),
  items: z.array(LineItem),
  captures: z.array(RailCapture),
});
export type RailOrder = z.infer<typeof RailOrder>;

export const ChargeRequest = z.object({
  scenarioRunId: z.string(),
  requestId: z.string(),
  items: z.array(LineItem),
  fees: z.array(Fee),
  total: Money,
  description: z.string(),
});
export type ChargeRequest = z.infer<typeof ChargeRequest>;

export const ChargeResult = z.object({
  orderId: z.string(),
  status: z.string(),
  captureId: z.string().optional(),
});
export type ChargeResult = z.infer<typeof ChargeResult>;

export const RefundRequest = z.object({
  requestId: z.string(),
  captureId: z.string(),
  /** Omitted means refund whatever is still refundable. */
  amount: Money.optional(),
  reason: z.string().optional(),
});
export type RefundRequest = z.infer<typeof RefundRequest>;

export const RefundResult = z.object({
  refundId: z.string(),
  status: z.string(),
  amount: Money,
});
export type RefundResult = z.infer<typeof RefundResult>;

export const LedgerCompleteness = z.enum(["ok", "webhook_extra", "missing"]);
export type LedgerCompleteness = z.infer<typeof LedgerCompleteness>;

/** Facts the auditor reads (ARCHITECTURE 5.5). Counts only COMPLETED captures and refunds. */
export const LedgerSnapshot = z.object({
  orders: z.array(RailOrder),
  net_captured: Money,
  capture_count: z.number().int().nonnegative(),
  ledger_completeness: LedgerCompleteness.optional(),
});
export type LedgerSnapshot = z.infer<typeof LedgerSnapshot>;
