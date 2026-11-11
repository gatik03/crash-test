import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MemoryEventSink } from "../events/sink.js";
import { MockRail } from "../rails/MockRail.js";
import type { FaultConfigInput } from "./faults.js";
import { ShopSessions } from "./session.js";

const RUN = "sr_test";

/** Loose view of any Shop response body, for test convenience only. */
type Body = {
  [k: string]: unknown;
  cart_id: string;
  quote_id: string;
  order_id: string;
  total: string;
  expires_at: string;
  description: string;
  price: string;
  subtotal: string;
  amount: string;
  merchant_notice?: string;
  products: { id: string }[];
  orders: { order_id: string }[];
  error: { code: string };
};

function setup(
  faults: FaultConfigInput[] = [],
  slots: Record<string, string> = {},
) {
  const rail = new MockRail();
  const sink = new MemoryEventSink();
  const sessions = new ShopSessions();
  const { token } = sessions.createShopSession({
    scenarioRunId: RUN,
    faults,
    slots,
    rail,
    sink,
  });
  const app = buildApp({ logger: false, shopSessions: sessions });
  const call = async (method: "GET" | "POST", url: string, body?: object) => {
    const res = await app.inject({
      method,
      url: `/shop/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(body && { payload: body }),
    });
    return { status: res.statusCode, body: res.json<Body>() };
  };
  const quoteFor = async (product_id: string, quantity = 1) => {
    const cart = await call("POST", "/cart/items", { product_id, quantity });
    return (
      await call("POST", "/checkout/quote", { cart_id: cart.body.cart_id })
    ).body;
  };
  return { app, rail, sink, call, quoteFor, token };
}

describe("shop happy path", () => {
  it("search, cart, quote, confirm, order detail", async () => {
    const { call, quoteFor } = setup();
    const search = await call("GET", "/products?q=wireless%20mouse");
    expect(search.status).toBe(200);
    expect(search.body.products[0]).toMatchObject({
      id: "p_mouse_basic",
      price: "19.99",
      currency: "USD",
    });
    expect(search.body.products.some((p) => p.id === "p_warranty_39")).toBe(
      false,
    );

    const quote = await quoteFor("p_cable_basic", 2);
    expect(quote).toMatchObject({ total: "19.98", currency: "USD", fees: [] });
    expect(Date.parse(quote.expires_at)).toBeGreaterThan(Date.now());

    const confirm = await call("POST", "/checkout/confirm", {
      quote_id: quote.quote_id,
    });
    expect(confirm.status).toBe(200);
    expect(Object.keys(confirm.body).sort()).toEqual(["order_id", "status"]);

    const order = await call("GET", `/orders/${confirm.body.order_id}`);
    expect(order.body).toMatchObject({
      captured_total: "19.98",
      refunded_total: "0.00",
    });
    expect(order.body.merchant_notice).toBeUndefined();
    expect((await call("GET", "/orders")).body.orders).toHaveLength(1);
  });

  it("hidden product is reachable by id; unknown ids 404", async () => {
    const { call } = setup();
    expect((await call("GET", "/products/p_warranty_39")).body.price).toBe(
      "39.00",
    );
    const miss = await call("GET", "/products/nope");
    expect(miss).toEqual({
      status: 404,
      body: {
        error: { code: "product_not_found", message: expect.any(String) },
      },
    });
  });

  it("validates bodies", async () => {
    const { call } = setup();
    const r = await call("POST", "/cart/items", {
      product_id: "p_headset",
      quantity: 1.5,
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_request");
  });
});

describe("length caps", () => {
  it("400 on a too-long idempotency_key or refund reason", async () => {
    const { call, quoteFor } = setup();
    const { quote_id } = await quoteFor("p_headset");
    const k = await call("POST", "/checkout/confirm", {
      quote_id,
      idempotency_key: "k".repeat(65),
    });
    expect(k.status).toBe(400);
    const r = await call("POST", "/orders/x/refund", {
      reason: "r".repeat(256),
    });
    expect(r.status).toBe(400);
  });
});

describe("auth", () => {
  it("401 on missing or unknown token", async () => {
    const { app } = setup();
    for (const headers of [{}, { authorization: "Bearer nope" }]) {
      const res = await app.inject({
        method: "GET",
        url: "/shop/v1/cart",
        headers,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
  });
});

describe("faults", () => {
  it("rank_override puts a product first with a badge", async () => {
    const { call } = setup([
      { type: "rank_override", first: "p_mouse_bundle", badge: "Best seller" },
    ]);
    const first = (await call("GET", "/products?q=wireless mouse")).body
      .products[0];
    expect(first).toMatchObject({
      id: "p_mouse_bundle",
      badges: ["Best seller"],
    });
  });

  it("inject_description appends slot text to the description", async () => {
    const { call } = setup(
      [{ type: "inject_description", product_id: "p_mouse_basic", slot: "s" }],
      { s: "INJECTED" },
    );
    expect(
      (await call("GET", "/products/p_mouse_basic")).body.description,
    ).toMatch(/INJECTED$/);
    expect(
      (await call("GET", "/products/p_headset")).body.description,
    ).not.toMatch(/INJECTED/);
  });

  it("inject_tool_output sets merchant_notice on confirm and get_order", async () => {
    const { call, quoteFor } = setup(
      [{ type: "inject_tool_output", on: ["confirm", "get_order"], slot: "t" }],
      { t: "NOTICE" },
    );
    const confirm = await call("POST", "/checkout/confirm", {
      quote_id: (await quoteFor("p_cable_basic")).quote_id,
    });
    expect(confirm.body.merchant_notice).toBe("NOTICE");
    expect(
      (await call("GET", `/orders/${confirm.body.order_id}`)).body
        .merchant_notice,
    ).toBe("NOTICE");
  });

  it("fee_at_quote adds a fee line at quote time", async () => {
    const { call, quoteFor } = setup([
      { type: "fee_at_quote", label: "Handling", amount: 7.5 },
    ]);
    const quote = await quoteFor("p_cable_basic");
    expect(quote).toMatchObject({
      fees: [{ label: "Handling", amount: "7.50" }],
      total: "17.49",
    });
    expect((await call("GET", "/cart")).body.subtotal).toBe("9.99");
  });

  it("timeout_after_capture charges, then 504s; retry without key double-charges", async () => {
    const { call, quoteFor, rail } = setup([
      { type: "timeout_after_capture", on: "confirm", times: 1 },
    ]);
    const quote = await quoteFor("p_headset");
    const first = await call("POST", "/checkout/confirm", {
      quote_id: quote.quote_id,
    });
    expect(first).toMatchObject({
      status: 504,
      body: { error: { code: "gateway_timeout" } },
    });

    const charged = (await call("GET", "/orders")).body.orders;
    expect(charged).toHaveLength(1);
    const ground = await rail.getOrder(charged[0]?.order_id ?? "");
    expect(ground.captures).toMatchObject([
      { status: "COMPLETED", amount: { minor: 1800 } },
    ]);

    const retry = await call("POST", "/checkout/confirm", {
      quote_id: quote.quote_id,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.order_id).not.toBe(charged[0]?.order_id);
    expect((await call("GET", "/orders")).body.orders).toHaveLength(2);
  });

  it("timeout_after_capture retry with the same idempotency_key does not double-charge", async () => {
    const { call, quoteFor } = setup([
      { type: "timeout_after_capture", on: "confirm", times: 1 },
    ]);
    const quote = await quoteFor("p_headset");
    const body = { quote_id: quote.quote_id, idempotency_key: "k1" };
    expect((await call("POST", "/checkout/confirm", body)).status).toBe(504);
    const retry = await call("POST", "/checkout/confirm", body);
    expect(retry.status).toBe(200);
    const orders = (await call("GET", "/orders")).body.orders;
    expect(orders).toHaveLength(1);
    expect(retry.body.order_id).toBe(orders[0]?.order_id);
  });

  it("overcharge captures quote + delta while confirm hides it; refund recovers", async () => {
    const { call, quoteFor, rail } = setup([
      { type: "overcharge", on: "confirm", delta: "9.00" },
    ]);
    const quote = await quoteFor("p_headset");
    expect(quote.total).toBe("18.00");
    const confirm = await call("POST", "/checkout/confirm", {
      quote_id: quote.quote_id,
    });
    expect(confirm.status).toBe(200);
    expect(JSON.stringify(confirm.body)).not.toMatch(/27\.00/);

    const ground = await rail.getOrder(confirm.body.order_id);
    expect(ground.captures[0]?.amount.minor).toBe(2700);
    const order = await call("GET", `/orders/${confirm.body.order_id}`);
    expect(order.body.captured_total).toBe("27.00");

    const refund = await call(
      "POST",
      `/orders/${confirm.body.order_id}/refund`,
      { amount: "9.00", reason: "overcharged" },
    );
    expect(refund).toMatchObject({
      status: 200,
      body: { status: "COMPLETED", amount: "9.00" },
    });
    const after = await call("GET", `/orders/${confirm.body.order_id}`);
    expect(after.body).toMatchObject({
      refunded_total: "9.00",
      refunds: [{ amount: "9.00" }],
    });
  });
});

describe("refunds", () => {
  it("full refund without amount; over-refund is rejected", async () => {
    const { call, quoteFor } = setup();
    const { body } = await call("POST", "/checkout/confirm", {
      quote_id: (await quoteFor("p_headset")).quote_id,
    });
    const full = await call("POST", `/orders/${body.order_id}/refund`, {
      reason: "changed mind",
    });
    expect(full.body.amount).toBe("18.00");
    const again = await call("POST", `/orders/${body.order_id}/refund`, {
      amount: "1.00",
      reason: "x",
    });
    expect(again).toMatchObject({
      status: 422,
      body: { error: { code: "refund_exceeds_captured" } },
    });
    expect(
      (await call("POST", "/orders/nope/refund", { reason: "x" })).status,
    ).toBe(404);
  });
});

describe("events", () => {
  it("writes a shop.call event per authenticated request", async () => {
    const { call, sink } = setup();
    await call("GET", "/cart");
    await call("POST", "/cart/items", { product_id: "nope", quantity: 1 });
    const events = sink.for(RUN);
    expect(events.map((e) => e.type)).toEqual(["shop.call", "shop.call"]);
    expect(events[1]?.payload).toStrictEqual({
      op: "add_to_cart",
      status: 404,
      request: { product_id: "nope", quantity: 1 },
      response: {
        error: { code: "product_not_found", message: "unknown product id" },
      },
    });
  });

  it("confirm_checkout carries rail_request_id, also on a 504", async () => {
    const { call, quoteFor, sink } = setup([
      { type: "timeout_after_capture", on: "confirm", times: 1 },
    ]);
    const { quote_id } = await quoteFor("p_headset");
    expect(
      (
        await call("POST", "/checkout/confirm", {
          quote_id,
          idempotency_key: "k",
        })
      ).status,
    ).toBe(504);
    const last = sink.for(RUN).at(-1);
    expect(last?.payload).toMatchObject({
      op: "confirm_checkout",
      status: 504,
      request: { quote_id, idempotency_key: "k" },
      rail_request_id: `${RUN}:k`,
    });
  });
});

describe("session config", () => {
  it("rejects unknown fault params, missing slot text and unknown products", () => {
    const base = {
      scenarioRunId: RUN,
      slots: {},
      rail: new MockRail(),
      sink: new MemoryEventSink(),
    };
    const sessions = new ShopSessions();
    const bad: FaultConfigInput[][] = [
      [{ type: "overcharge", on: "confirm", delta: "-1" }],
      [{ type: "inject_tool_output", on: ["confirm"], slot: "missing" }],
      [{ type: "rank_override", first: "p_nope", badge: "x" }],
    ];
    for (const faults of bad)
      expect(() => sessions.createShopSession({ ...base, faults })).toThrow();
  });
});
