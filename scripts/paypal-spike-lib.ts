// Shared helpers for the M1 PayPal spike scripts. Spike-only: the real client is
// apps/server/src/rails/paypalClient.ts (M2), which will replace this.
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Sandbox only (AGENTS rule 1). Never point this at the live host.
export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

const Env = z.object({
  PAYPAL_ENV: z.literal("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  WALLET_VAULT_ID: z.string().default(""),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid env vars: ${names}. Copy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

export async function getToken(env: Env): Promise<string> {
  const basic = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body: unknown = await res.json();
  if (!res.ok)
    throw new PayPalError("POST /v1/oauth2/token", res.status, null, body);
  return TokenResponse.parse(body).access_token;
}

export interface PayPalResponse {
  label: string;
  status: number;
  debugId: string | null;
  body: unknown;
}

export class PayPalError extends Error {
  constructor(
    label: string,
    status: number,
    debugId: string | null,
    body: unknown,
  ) {
    super(
      `${label} failed: HTTP ${status}, debug id ${debugId ?? "?"}\n${JSON.stringify(body, null, 2)}`,
    );
  }
}

/** One PayPal REST call. Returns the response instead of throwing, so the spike can observe it. */
export async function paypal(
  token: string,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; requestId?: string } = {},
): Promise<PayPalResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return {
    label: `${method} ${path}`,
    status: res.status,
    debugId: res.headers.get("paypal-debug-id"),
    body: text ? (JSON.parse(text) as unknown) : null,
  };
}

export function expectOk(res: PayPalResponse): unknown {
  if (res.status < 200 || res.status >= 300) {
    throw new PayPalError(res.label, res.status, res.debugId, res.body);
  }
  return res.body;
}

// Only the fields the spike reads; zod drops the rest.
const Amount = z.object({ currency_code: z.string(), value: z.string() });
const Capture = z.object({
  id: z.string(),
  status: z.string(),
  amount: Amount,
});
const Refund = z.object({
  id: z.string(),
  status: z.string(),
  amount: Amount.optional(),
});
export const RefundResponse = Refund;

export const Order = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z.array(Capture).optional(),
            refunds: z.array(Refund).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  payment_source: z
    .object({
      paypal: z
        .object({
          email_address: z.string().optional(),
          attributes: z
            .object({
              vault: z
                .object({
                  id: z.string().optional(),
                  status: z.string().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
export type Order = z.infer<typeof Order>;

export const capturesOf = (o: Order) =>
  o.purchase_units?.[0]?.payments?.captures ?? [];
export const refundsOf = (o: Order) =>
  o.purchase_units?.[0]?.payments?.refunds ?? [];
export const vaultOf = (o: Order) =>
  o.payment_source?.paypal?.attributes?.vault;

export async function getOrder(token: string, id: string): Promise<Order> {
  return Order.parse(
    expectOk(await paypal(token, "GET", `/v2/checkout/orders/${id}`)),
  );
}

export const newRequestId = (): string => randomUUID();
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** "buyer@example.com" → "b***@example.com" (AGENTS rule 6). */
export function maskEmail(email: string | undefined): string {
  if (!email) return "(none)";
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}
