import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { add, toPayPalValue, type Money } from "@crash-test/shared";
import { RailError } from "../rails/Rail.js";
import { searchProducts, type Product } from "./catalog.js";
import {
  afterCharge,
  beforeCharge,
  decorateOrderView,
  decorateProducts,
  decorateQuote,
} from "./faults.js";
import {
  isExpired,
  lineTotal,
  priceQuote,
  subtotal,
  UsdAmount,
  type QuoteLine,
} from "./quote.js";
import type { ShopSession, ShopSessions } from "./session.js";

type Result = { status: number; body: unknown };

const fail = (status: number, code: string, message: string): Result => ({
  status,
  body: { error: { code, message } },
});

const money = toPayPalValue;

const AddItemBody = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().positive().max(100),
});
const QuoteBody = z.object({ cart_id: z.string().min(1) });
const ConfirmBody = z.object({
  quote_id: z.string().min(1),
  idempotency_key: z.string().min(1).max(64).optional(),
});
const RefundBody = z.object({
  amount: UsdAmount.optional(),
  reason: z.string().min(1).max(255),
});

const productView = (p: Product) => ({
  id: p.id,
  name: p.name,
  price: money(p.price),
  currency: p.price.currency,
  category: p.category,
  badges: p.badges,
  description: p.description,
});

const lineView = (l: QuoteLine) => ({
  product_id: l.productId,
  name: l.name,
  quantity: l.quantity,
  unit_price: money(l.unitPrice),
  line_total: money(lineTotal(l)),
});

function cartLines(s: ShopSession): QuoteLine[] {
  const lines: QuoteLine[] = [];
  for (const [productId, quantity] of s.cart.items) {
    const p = s.catalog.find((x) => x.id === productId);
    if (p)
      lines.push({ productId, name: p.name, quantity, unitPrice: p.price });
  }
  return lines;
}

function cartView(s: ShopSession) {
  const lines = cartLines(s);
  return {
    cart_id: s.cart.id,
    items: lines.map(lineView),
    subtotal: money(subtotal(lines)),
    currency: "USD",
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T | Result {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  return fail(
    400,
    "invalid_request",
    r.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; "),
  );
}
const isResult = (x: unknown): x is Result =>
  typeof x === "object" && x !== null && "status" in x && "body" in x;

type Req = FastifyRequest<{
  Params: Record<string, string>;
  Querystring: Record<string, string>;
}>;

/** Filled by `confirm` before it calls the rail, so the event carries it even on failure. */
type CallMeta = { railRequestId?: string };

async function confirm(
  s: ShopSession,
  body: unknown,
  meta: CallMeta,
): Promise<Result> {
  const input = parse(ConfirmBody, body);
  if (isResult(input)) return input;
  const quote = s.quotes.get(input.quote_id);
  if (!quote) return fail(404, "quote_not_found", "unknown quote_id");
  if (isExpired(quote, new Date()))
    return fail(409, "quote_expired", "quote expired, request a new one");

  const requestId =
    input.idempotency_key !== undefined
      ? `${s.scenarioRunId}:${input.idempotency_key}`
      : `${s.scenarioRunId}:auto:${++s.counters.autoRequest}`;
  const req = beforeCharge(s, {
    scenarioRunId: s.scenarioRunId,
    requestId,
    items: quote.lines.map((l) => ({
      name: l.name,
      sku: l.productId,
      quantity: l.quantity,
      unitAmount: l.unitPrice,
    })),
    fees: quote.fees,
    total: quote.total,
    description: "Crash Test Shop order",
  });
  meta.railRequestId = requestId;
  const result = await s.rail.charge(req);
  if (!s.orders.has(result.orderId)) {
    s.orders.set(result.orderId, {
      orderId: result.orderId,
      ...(result.captureId !== undefined && { captureId: result.captureId }),
      quoteId: quote.id,
      status: result.status,
      quotedTotal: quote.total,
      createdAt: new Date(),
    });
  }
  const after = afterCharge(s);
  if (after.timeout)
    return fail(504, "gateway_timeout", "upstream payment gateway timed out");
  return {
    status: 200,
    body: {
      order_id: result.orderId,
      status: result.status,
      ...(after.merchantNotice !== undefined && {
        merchant_notice: after.merchantNotice,
      }),
    },
  };
}

const CAPTURED = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);

async function orderDetail(s: ShopSession, id: string): Promise<Result> {
  const local = s.orders.get(id);
  if (!local) return fail(404, "order_not_found", "unknown order id");
  const o = await s.rail.getOrder(id);
  let captured: Money = { minor: 0, currency: "USD" };
  let refunded: Money = { minor: 0, currency: "USD" };
  const refunds: { refund_id: string; status: string; amount: string }[] = [];
  for (const c of o.captures) {
    if (CAPTURED.has(c.status)) captured = add(captured, c.amount);
    for (const r of c.refunds) {
      if (r.status === "COMPLETED") refunded = add(refunded, r.amount);
      refunds.push({
        refund_id: r.id,
        status: r.status,
        amount: money(r.amount),
      });
    }
  }
  return {
    status: 200,
    body: decorateOrderView(s, {
      order_id: o.id,
      status: o.status,
      quote_id: local.quoteId,
      items: o.items.map((i) => ({
        product_id: i.sku,
        name: i.name,
        quantity: i.quantity,
        unit_price: money(i.unitAmount),
      })),
      captured_total: money(captured),
      refunded_total: money(refunded),
      currency: "USD",
      refunds,
    }),
  };
}

async function refund(
  s: ShopSession,
  id: string,
  body: unknown,
): Promise<Result> {
  const input = parse(RefundBody, body);
  if (isResult(input)) return input;
  const local = s.orders.get(id);
  if (!local) return fail(404, "order_not_found", "unknown order id");
  if (local.captureId === undefined)
    return fail(409, "not_captured", "order has no capture to refund");
  const r = await s.rail.refund({
    requestId: `${s.scenarioRunId}:refund:${++s.counters.refund}`,
    captureId: local.captureId,
    ...(input.amount !== undefined && { amount: input.amount }),
    reason: input.reason,
  });
  return {
    status: 200,
    body: { refund_id: r.refundId, status: r.status, amount: money(r.amount) },
  };
}

function handle(
  s: ShopSession,
  req: Req,
  meta: CallMeta,
): Promise<Result> | Result {
  const route = `${req.method} ${req.routeOptions.url ?? ""}`;
  switch (route) {
    case "GET /shop/v1/products": {
      const found = searchProducts(s.catalog, req.query.q ?? "");
      return {
        status: 200,
        body: { products: decorateProducts(s, found).map(productView) },
      };
    }
    case "GET /shop/v1/products/:id": {
      const p = s.catalog.find((x) => x.id === req.params.id);
      const [view] = p ? decorateProducts(s, [p]) : [];
      return view
        ? { status: 200, body: productView(view) }
        : fail(404, "product_not_found", "unknown product id");
    }
    case "POST /shop/v1/cart/items": {
      const input = parse(AddItemBody, req.body);
      if (isResult(input)) return input;
      if (!s.catalog.some((p) => p.id === input.product_id))
        return fail(404, "product_not_found", "unknown product id");
      const qty = (s.cart.items.get(input.product_id) ?? 0) + input.quantity;
      s.cart.items.set(input.product_id, qty);
      return { status: 200, body: cartView(s) };
    }
    case "GET /shop/v1/cart":
      return { status: 200, body: cartView(s) };
    case "POST /shop/v1/checkout/quote": {
      const input = parse(QuoteBody, req.body);
      if (isResult(input)) return input;
      if (input.cart_id !== s.cart.id)
        return fail(404, "cart_not_found", "unknown cart_id");
      const lines = cartLines(s);
      if (lines.length === 0) return fail(400, "cart_empty", "cart is empty");
      const q = priceQuote({
        id: `q_${nanoid()}`,
        cartId: s.cart.id,
        lines,
        fees: decorateQuote(s, []),
        now: new Date(),
      });
      s.quotes.set(q.id, q);
      return {
        status: 200,
        body: {
          quote_id: q.id,
          items: q.lines.map(lineView),
          fees: q.fees.map((f) => ({
            label: f.label,
            amount: money(f.amount),
          })),
          total: money(q.total),
          currency: "USD",
          expires_at: q.expiresAt.toISOString(),
        },
      };
    }
    case "POST /shop/v1/checkout/confirm":
      return confirm(s, req.body, meta);
    case "GET /shop/v1/orders":
      return {
        status: 200,
        body: {
          orders: [...s.orders.values()].map((o) => ({
            order_id: o.orderId,
            quote_id: o.quoteId,
            status: o.status,
            created_at: o.createdAt.toISOString(),
          })),
        },
      };
    case "GET /shop/v1/orders/:id":
      return orderDetail(s, req.params.id ?? "");
    case "POST /shop/v1/orders/:id/refund":
      return refund(s, req.params.id ?? "", req.body);
    default:
      return fail(404, "not_found", "unknown route");
  }
}

const RAIL_STATUS = {
  not_found: 404,
  invalid_request: 400,
  refund_exceeds_captured: 422,
} as const;

/** Shop API (ARCHITECTURE 5.1). Register with prefix `/shop/v1`. */
export const shopRoutes: FastifyPluginAsync<{
  sessions: ShopSessions;
}> = async (app, { sessions }) => {
  app.setErrorHandler(
    (e: { statusCode?: number; message: string }, _req, reply) => {
      const status = e.statusCode ?? 500;
      return reply
        .code(status)
        .send(
          fail(status, status < 500 ? "invalid_request" : "internal", e.message)
            .body,
        );
    },
  );
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(fail(404, "not_found", "unknown route").body),
  );

  const handler = async (op: string, req: Req, reply: FastifyReply) => {
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const s = token === undefined ? undefined : sessions.get(token);
    if (!s)
      return reply
        .code(401)
        .send(fail(401, "unauthorized", "missing or unknown shop token").body);

    const meta: CallMeta = {};
    let r: Result;
    try {
      r = await handle(s, req, meta);
    } catch (e) {
      if (!(e instanceof RailError)) req.log.error(e);
      r =
        e instanceof RailError
          ? fail(RAIL_STATUS[e.code], e.code, e.message)
          : fail(
              502,
              "payment_provider_error",
              "payment provider request failed",
            );
    }
    s.sink.append({
      scenarioRunId: s.scenarioRunId,
      type: "shop.call",
      // Auditor contract: ShopCallPayload in engine/auditContext.ts (docs/DECISIONS.md).
      payload: {
        op,
        status: r.status,
        request: {
          ...req.params,
          ...req.query,
          ...(typeof req.body === "object" && req.body),
        },
        response: r.body,
        ...(meta.railRequestId !== undefined && {
          rail_request_id: meta.railRequestId,
        }),
      },
    });
    return reply.code(r.status).send(r.body);
  };

  // `op` is the agent tool name each endpoint maps to (ARCHITECTURE 5.4).
  for (const [method, url, op] of [
    ["GET", "/products", "search_products"],
    ["GET", "/products/:id", "get_product"],
    ["POST", "/cart/items", "add_to_cart"],
    ["GET", "/cart", "view_cart"],
    ["POST", "/checkout/quote", "create_quote"],
    ["POST", "/checkout/confirm", "confirm_checkout"],
    ["GET", "/orders", "list_orders"],
    ["GET", "/orders/:id", "get_order"],
    ["POST", "/orders/:id/refund", "refund_order"],
  ] as const)
    app.route({
      method,
      url,
      handler: (req: Req, reply) => handler(op, req, reply),
    });
};
