import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryEventSink } from "../events/sink.js";
import { loadConfig } from "../config.js";
import { PayPalClient } from "./paypalClient.js";
import { RailError } from "./Rail.js";
import { PayPalSandboxRail, toRailOrder } from "./PayPalSandboxRail.js";
import { railContract } from "./railContract.js";

const SANDBOX = process.env.SANDBOX_TESTS === "1";

describe("toRailOrder", () => {
  const amt = (value: string) => ({ currency_code: "USD" as const, value });
  const up = (id: string) => [
    { rel: "self", href: "https://x/v2/payments/refunds/R" },
    { rel: "up", href: `https://x/v2/payments/captures/${id}` },
  ];

  it("nests refunds under the capture their up link names", () => {
    const order = toRailOrder({
      id: "O",
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: "sr",
          items: [
            { name: "n", sku: "s", quantity: "2", unit_amount: amt("1.50") },
          ],
          payments: {
            captures: [
              { id: "C1", status: "REFUNDED", amount: amt("17.49") },
              { id: "C2", status: "COMPLETED", amount: amt("3.00") },
            ],
            refunds: [
              {
                id: "R1",
                status: "COMPLETED",
                amount: amt("9.00"),
                links: up("C1"),
              },
              {
                id: "R2",
                status: "COMPLETED",
                amount: amt("1.00"),
                links: up("C2"),
              },
            ],
          },
        },
      ],
    });
    expect(order.customId).toBe("sr");
    expect(order.items).toEqual([
      {
        name: "n",
        sku: "s",
        quantity: 2,
        unitAmount: { minor: 150, currency: "USD" },
      },
    ]);
    expect(
      order.captures.map((c) => [
        c.id,
        c.amount.minor,
        c.refunds.map((r) => r.id),
      ]),
    ).toEqual([
      ["C1", 1749, ["R1"]],
      ["C2", 300, ["R2"]],
    ]);
  });

  it("refuses to guess when a refund cannot be attributed", () => {
    expect(() =>
      toRailOrder({
        id: "O",
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                { id: "C1", status: "COMPLETED", amount: amt("1.00") },
                { id: "C2", status: "COMPLETED", amount: amt("1.00") },
              ],
              refunds: [{ id: "R", status: "COMPLETED", amount: amt("1.00") }],
            },
          },
        ],
      }),
    ).toThrow(/cannot attribute/);
  });
});

describe("PayPalSandboxRail write-ahead log", () => {
  it("writes intent then error when PayPal fails, and never sends the secret", async () => {
    const sink = new MemoryEventSink();
    const fetchFake: typeof fetch = (input) =>
      Promise.resolve(
        String(input).endsWith("/token")
          ? Response.json({ access_token: "tok", expires_in: 3600 })
          : new Response(JSON.stringify({ name: "UNPROCESSABLE_ENTITY" }), {
              status: 422,
            }),
      );
    const rail = new PayPalSandboxRail({
      client: new PayPalClient({
        clientId: "id",
        clientSecret: "s3cret",
        fetch: fetchFake,
      }),
      vaultId: "v",
      sink,
    });
    const usd = (minor: number) => ({ minor, currency: "USD" as const });
    await expect(
      rail.charge({
        scenarioRunId: "sr",
        requestId: "q",
        items: [{ name: "n", sku: "s", quantity: 1, unitAmount: usd(100) }],
        fees: [],
        total: usd(100),
        description: "d",
      }),
    ).rejects.toThrow(/HTTP 422/);
    expect(sink.events.map((e) => e.type)).toEqual([
      "rail.charge.intent",
      "rail.charge.error",
    ]);
    expect(JSON.stringify(sink.events)).not.toMatch(/s3cret|tok/);
  });
});

describe("recoverByRequestId", () => {
  const recover = (status: number, body: unknown) => {
    const fetchFake: typeof fetch = (input) =>
      Promise.resolve(
        String(input).endsWith("/token")
          ? Response.json({ access_token: "tok", expires_in: 3600 })
          : new Response(JSON.stringify(body), { status }),
      );
    const rail = new PayPalSandboxRail({
      client: new PayPalClient({
        clientId: "id",
        clientSecret: "s",
        fetch: fetchFake,
        sleep: () => Promise.resolve(),
      }),
      vaultId: "v",
      sink: new MemoryEventSink(),
    });
    const usd = { minor: 100, currency: "USD" as const };
    return rail.recoverByRequestId({
      scenarioRunId: "sr",
      requestId: "q",
      items: [{ name: "n", sku: "s", quantity: 1, unitAmount: usd }],
      fees: [],
      total: usd,
      description: "d",
    });
  };

  it("returns null only for the unknown-vault rejection", async () => {
    expect(await recover(403, { name: "NOT_AUTHORIZED" })).toBeNull();
    expect(
      await recover(422, { details: [{ issue: "INVALID_RESOURCE_ID" }] }),
    ).toBeNull();
  });

  it.each([401, 429, 400, 403, 422])("throws on other %i", async (status) => {
    await expect(recover(status, { name: "OTHER" })).rejects.toThrow(/HTTP/);
  });
});

describe.skipIf(!SANDBOX)(
  "PayPalSandboxRail (real sandbox)",
  { timeout: 60_000 },
  () => {
    try {
      process.loadEnvFile?.(); // .env at the repo root (vitest's cwd); never overrides set vars
    } catch {
      // No .env: rely on the process environment.
    }
    const config = loadConfig({
      ...process.env,
      PAYPAL_RAIL: "paypal-sandbox",
    });
    const client = new PayPalClient({
      clientId: config.PAYPAL_CLIENT_ID ?? "",
      clientSecret: config.PAYPAL_CLIENT_SECRET ?? "",
    });
    const rail = new PayPalSandboxRail({
      client,
      vaultId: config.WALLET_VAULT_ID ?? "",
      sink: new MemoryEventSink(),
    });
    const captured = new Set<string>();
    const charge = rail.charge.bind(rail);
    rail.charge = async (req) => {
      const res = await charge(req);
      if (res.captureId) captured.add(res.captureId);
      return res;
    };

    railContract(() => rail);

    // Refund whatever the contract tests left captured.
    afterAll(async () => {
      for (const captureId of captured) {
        await rail
          .refund({
            requestId: randomUUID(),
            captureId,
            reason: "test cleanup",
          })
          .catch((err: unknown) => {
            if (!(
              err instanceof RailError && err.code === "refund_exceeds_captured"
            ))
              throw err;
          });
      }
    }, 120_000);
  },
);
