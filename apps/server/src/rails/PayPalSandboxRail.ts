import { z } from "zod";
import {
  fromPayPalValue,
  toPayPalValue,
  ChargeRequest,
  type ChargeResult,
  type Money,
  type RailOrder,
  type RefundRequest,
  type RefundResult,
} from "@crash-test/shared";
import type { EventSink } from "../events/sink.js";
import {
  chargeBreakdown,
  loggedCharge,
  RailError,
  type Rail,
  type RailHealth,
} from "./Rail.js";
import {
  isOk,
  PayPalClient,
  PayPalHttpError,
  type PayPalResponse,
} from "./paypalClient.js";

// Only the fields we read; zod drops the rest (including payer PII).
const Amount = z.object({ currency_code: z.literal("USD"), value: z.string() });
const Link = z.object({ href: z.string(), rel: z.string() });
const Refund = z.object({
  id: z.string(),
  status: z.string(),
  amount: Amount,
  links: z.array(Link).optional(),
});
const Capture = z.object({
  id: z.string(),
  status: z.string(),
  amount: Amount,
});
const Order = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().optional(),
        items: z
          .array(
            z.object({
              name: z.string(),
              sku: z.string().optional(),
              quantity: z.string(),
              unit_amount: Amount,
            }),
          )
          .optional(),
        payments: z
          .object({
            captures: z.array(Capture).optional(),
            refunds: z.array(Refund).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
type Order = z.infer<typeof Order>;

const money = (a: z.infer<typeof Amount>): Money =>
  fromPayPalValue(a.value, a.currency_code);
const amount = (m: Money) => ({
  currency_code: m.currency,
  value: toPayPalValue(m),
});

// A vault id PayPal cannot charge: a known request id still replays, an unknown one gets 403.
const RECOVERY_PROBE_VAULT_ID = "0000000000000000";

export type PayPalSandboxRailOptions = {
  client: PayPalClient;
  vaultId: string;
  sink?: EventSink;
};

/** Real PayPal sandbox rail: Orders v2 with a vaulted wallet (ARCHITECTURE 7.5–7.7). */
export class PayPalSandboxRail implements Rail {
  readonly kind = "paypal-sandbox" as const;

  constructor(private readonly opts: PayPalSandboxRailOptions) {}

  async preflight(): Promise<RailHealth> {
    let token: RailHealth["checks"][number];
    try {
      await this.opts.client.accessToken();
      token = { name: "token", ok: true };
    } catch (err) {
      token = { name: "token", ok: false, detail: errorText(err) };
    }
    const vault = { name: "wallet_vault_id", ok: this.opts.vaultId !== "" };
    return { ok: token.ok && vault.ok, checks: [token, vault] };
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (!ChargeRequest.safeParse(req).success)
      throw new RailError("invalid_request", "bad charge request");
    const body = this.orderBody(req, this.opts.vaultId);
    return loggedCharge(this.opts.sink, req, async () =>
      toChargeResult(
        expectOk(
          "POST /v2/checkout/orders",
          await this.opts.client.request("POST", "/v2/checkout/orders", {
            body,
            requestId: req.requestId,
          }),
        ),
      ),
    );
  }

  /** Re-POST under the same request id with an unchargeable vault id: replays a known charge, never makes a new one. */
  async recoverByRequestId(req: ChargeRequest): Promise<ChargeResult | null> {
    const res = await this.opts.client.request("POST", "/v2/checkout/orders", {
      body: this.orderBody(req, RECOVERY_PROBE_VAULT_ID),
      requestId: req.requestId,
    });
    if (isOk(res)) return toChargeResult(res.body);
    const err = new PayPalHttpError(
      "POST /v2/checkout/orders (recover)",
      res.status,
      res.debugId,
      res.body,
    );
    // Only the probe's expected unknown-vault rejection means "no such charge".
    const unknownVault =
      (res.status === 403 &&
        (err.issues.includes("NOT_AUTHORIZED") ||
          err.message.includes("NOT_AUTHORIZED"))) ||
      (res.status === 422 &&
        err.issues.some((i) => /VAULT|INVALID_RESOURCE_ID/.test(i)));
    if (unknownVault) return null;
    throw err;
  }

  async getOrder(orderId: string): Promise<RailOrder> {
    const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
    const res = await this.opts.client.request("GET", path);
    if (res.status === 404)
      throw new RailError("not_found", `order ${orderId}`);
    return toRailOrder(Order.parse(expectOk(`GET ${path}`, res)));
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const path = `/v2/payments/captures/${encodeURIComponent(req.captureId)}/refund`;
    const res = await this.opts.client.request("POST", path, {
      body: req.amount
        ? { amount: amount(req.amount), note_to_payer: req.reason }
        : {},
      requestId: req.requestId,
    });
    if (res.status === 404)
      throw new RailError("not_found", `capture ${req.captureId}`);
    if (res.status === 422) {
      const err = new PayPalHttpError(
        `POST ${path}`,
        422,
        res.debugId,
        res.body,
      );
      if (err.issues.some((i) => REFUND_EXCEEDS.has(i)))
        throw new RailError("refund_exceeds_captured", err.message);
      throw err;
    }
    const r = Refund.parse(expectOk(`POST ${path}`, res));
    return { refundId: r.id, status: r.status, amount: money(r.amount) };
  }

  private orderBody(req: ChargeRequest, vaultId: string): unknown {
    const { itemTotal, fees } = chargeBreakdown(req);
    return {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: req.scenarioRunId,
          custom_id: req.scenarioRunId,
          description: req.description,
          amount: {
            ...amount(req.total),
            breakdown: {
              item_total: amount(itemTotal),
              ...(req.fees.length ? { handling: amount(fees) } : {}),
            },
          },
          items: req.items.map((i) => ({
            name: i.name,
            sku: i.sku,
            quantity: String(i.quantity),
            unit_amount: amount(i.unitAmount),
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: { paypal: { vault_id: vaultId } },
    };
  }
}

const REFUND_EXCEEDS = new Set([
  "REFUND_AMOUNT_EXCEEDED",
  "CAPTURE_FULLY_REFUNDED",
]);

function expectOk(label: string, res: PayPalResponse): unknown {
  if (!isOk(res))
    throw new PayPalHttpError(label, res.status, res.debugId, res.body);
  return res.body;
}

function toChargeResult(body: unknown): ChargeResult {
  const o = Order.parse(body);
  const captureId = o.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  return {
    orderId: o.id,
    status: o.status,
    ...(captureId ? { captureId } : {}),
  };
}

/** Refunds are listed beside captures; each one's `up` link names its capture. */
export function toRailOrder(o: Order): RailOrder {
  const pu = o.purchase_units?.[0];
  const captures = (pu?.payments?.captures ?? []).map((c) => ({
    id: c.id,
    status: c.status,
    amount: money(c.amount),
    refunds: [] as RailOrder["captures"][number]["refunds"],
  }));
  for (const r of pu?.payments?.refunds ?? []) {
    const up = r.links?.find((l) => l.rel === "up")?.href;
    const capture =
      captures.find((c) => up?.endsWith(`/captures/${c.id}`)) ??
      (captures.length === 1 ? captures[0] : undefined);
    if (!capture)
      throw new Error(
        `order ${o.id}: cannot attribute refund ${r.id} to a capture`,
      );
    capture.refunds.push({
      id: r.id,
      status: r.status,
      amount: money(r.amount),
    });
  }
  return {
    id: o.id,
    status: o.status,
    ...(pu?.custom_id ? { customId: pu.custom_id } : {}),
    items: (pu?.items ?? []).map((i) => ({
      name: i.name,
      sku: i.sku ?? "",
      quantity: Number(i.quantity),
      unitAmount: money(i.unit_amount),
    })),
    captures,
  };
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);
