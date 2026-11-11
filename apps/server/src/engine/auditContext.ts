import {
  DecimalMoney,
  type AppEvent,
  type AssertionCategory,
  type AssertionSpec,
  type LedgerSnapshot,
  type Money,
  type Policy,
  type Scenario,
} from "@crash-test/shared";
import { z } from "zod";
import { isCaptured } from "./ledger.js";

/**
 * Payload contracts the auditor reads. Producers (agent runtime, Shop) must write these;
 * see docs/DECISIONS.md. Events that do not match are ignored, which fails closed.
 */
export const AgentStepPayload = z.object({
  tool: z.string(),
  args: z.unknown(),
  result: z.unknown(),
});
export const RequestApprovalArgs = z.object({ amount: DecimalMoney });
export const RequestApprovalResult = z.object({ approved: z.boolean() });
export const AskUserArgs = z.object({ question: z.string() });

export const ShopCallPayload = z.object({
  /** Tool-style name: create_quote, confirm_checkout, get_order, ... */
  op: z.string(),
  status: z.number().int(),
  request: z.unknown(),
  response: z.unknown(),
  /** Set on confirm_checkout whenever the Shop called rail.charge, even if it then failed. */
  rail_request_id: z.string().optional(),
});
export const QuoteResponse = z.object({
  quote_id: z.string(),
  total: DecimalMoney,
});
export const ConfirmRequest = z.object({ quote_id: z.string() });

export type Quote = { seq: number; quoteId: string; total: Money };
export type Approval = { seq: number; approved: boolean; amount: Money };
export type Clarification = { seq: number; question: string };
export type Charge = {
  /** seq of the rail.charge.intent event. */
  seq: number;
  requestId: string;
  /** From the result event or recovered by request id; absent = no order exists. */
  orderId?: string;
  requestedTotal: Money;
  quoteId?: string;
  quoteTotal?: Money;
};

export type AuditContext = {
  scenario: Scenario;
  policy: Policy;
  events: readonly AppEvent[];
  quotes: Quote[];
  approvals: Approval[];
  clarifications: Clarification[];
  charges: Charge[];
  ledger: LedgerSnapshot;
  /** product id → category; the Shop catalog is the source. */
  categories: Readonly<Record<string, string>>;
};

export type Evidence = {
  source: "event" | "ledger" | "scenario";
  ref: string;
  note: string;
};

export type AssertionResult = {
  passed: boolean;
  expected: unknown;
  actual: unknown;
  evidence: Evidence[];
};

export interface Assertion<P> {
  type: string;
  category: AssertionCategory;
  evaluate(ctx: AuditContext, params: P): AssertionResult;
}

export type AssertionOf<T extends AssertionSpec["type"]> = Assertion<
  Extract<AssertionSpec, { type: T }>
>;

export function buildAuditContext(input: {
  scenario: Scenario;
  events: readonly AppEvent[];
  ledger: LedgerSnapshot;
  orderIdsByRequestId: Readonly<Record<string, string>>;
  categories: Readonly<Record<string, string>>;
}): AuditContext {
  const events = [...input.events].sort((a, b) => a.seq - b.seq);
  const quotes: Quote[] = [];
  const approvals: Approval[] = [];
  const clarifications: Clarification[] = [];
  const quoteIdByRequestId = new Map<string, string>();
  const intents: { seq: number; requestId: string; total: Money }[] = [];

  for (const e of events) {
    if (e.type === "agent.step") {
      const step = AgentStepPayload.safeParse(e.payload);
      if (!step.success) continue;
      if (step.data.tool === "request_approval") {
        const args = RequestApprovalArgs.safeParse(step.data.args);
        const result = RequestApprovalResult.safeParse(step.data.result);
        if (args.success && result.success)
          approvals.push({
            seq: e.seq,
            approved: result.data.approved,
            amount: args.data.amount,
          });
      } else if (step.data.tool === "ask_user") {
        const args = AskUserArgs.safeParse(step.data.args);
        if (args.success)
          clarifications.push({ seq: e.seq, question: args.data.question });
      }
    } else if (e.type === "shop.call") {
      const call = ShopCallPayload.safeParse(e.payload);
      if (!call.success) continue;
      const ok = call.data.status >= 200 && call.data.status < 300;
      if (call.data.op === "create_quote" && ok) {
        const q = QuoteResponse.safeParse(call.data.response);
        if (q.success)
          quotes.push({
            seq: e.seq,
            quoteId: q.data.quote_id,
            total: q.data.total,
          });
      } else if (
        call.data.op === "confirm_checkout" &&
        call.data.rail_request_id
      ) {
        const r = ConfirmRequest.safeParse(call.data.request);
        if (r.success)
          quoteIdByRequestId.set(call.data.rail_request_id, r.data.quote_id);
      }
    } else if (e.type === "rail.charge.intent") {
      intents.push({
        seq: e.seq,
        requestId: e.payload.requestId,
        total: e.payload.request.total,
      });
    }
  }

  const charges = intents.map((i): Charge => {
    const quoteId = quoteIdByRequestId.get(i.requestId);
    const quoteTotal = quotes.find((q) => q.quoteId === quoteId)?.total;
    const orderId = input.orderIdsByRequestId[i.requestId];
    return {
      seq: i.seq,
      requestId: i.requestId,
      requestedTotal: i.total,
      ...(orderId && { orderId }),
      ...(quoteId && { quoteId }),
      ...(quoteTotal && { quoteTotal }),
    };
  });

  return {
    scenario: input.scenario,
    policy: input.scenario.policy,
    events,
    quotes,
    approvals,
    clarifications,
    charges,
    ledger: input.ledger,
    categories: input.categories,
  };
}

/** Per-SKU quantities on orders with at least one capture that moved money. */
export function capturedItems(ledger: LedgerSnapshot): Map<string, number> {
  const qty = new Map<string, number>();
  for (const o of ledger.orders) {
    if (!o.captures.some(isCaptured)) continue;
    for (const i of o.items) qty.set(i.sku, (qty.get(i.sku) ?? 0) + i.quantity);
  }
  return qty;
}

export const orderRef = (id: string): Evidence["ref"] => `order:${id}`;
export const eventRef = (seq: number): Evidence["ref"] => `event:${seq}`;
