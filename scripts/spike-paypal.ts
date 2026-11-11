// M1 spike: charge the vaulted wallet, prove idempotency, read ground truth, refund.
// Run: pnpm spike   (needs WALLET_VAULT_ID from pnpm spike:vault)
import {
  capturesOf,
  expectOk,
  getOrder,
  getToken,
  loadEnv,
  newRequestId,
  Order,
  paypal,
  RefundResponse,
  refundsOf,
} from "./paypal-spike-lib.ts";

const env = loadEnv();
if (!env.WALLET_VAULT_ID)
  throw new Error("WALLET_VAULT_ID is empty. Run pnpm spike:vault first.");
const token = await getToken(env);
console.log("① token: ok");

const runId = `spike-${Date.now()}`;

// Same shape as ARCHITECTURE 7.5. Amounts are fixed strings: no float math (AGENTS rule 2).
const chargeBody = (ref: string) => ({
  intent: "CAPTURE",
  purchase_units: [
    {
      reference_id: ref,
      custom_id: ref,
      description: "Crash Test sandbox purchase",
      amount: {
        currency_code: "USD",
        value: "17.49",
        breakdown: {
          item_total: { currency_code: "USD", value: "9.99" },
          handling: { currency_code: "USD", value: "7.50" },
        },
      },
      items: [
        {
          name: "USB-C Cable 1 m",
          sku: "p_cable_basic",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "9.99" },
          category: "PHYSICAL_GOODS",
        },
      ],
    },
  ],
  payment_source: { paypal: { vault_id: env.WALLET_VAULT_ID } },
});

function firstCapture(o: Order) {
  const c = capturesOf(o)[0];
  if (!c) throw new Error(`Order ${o.id} (${o.status}) has no capture.`);
  return c;
}

let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`   ${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) failed = true;
};

// ② Charge with request id R1.
const r1 = newRequestId();
const firstRes = await paypal(token, "POST", "/v2/checkout/orders", {
  requestId: r1,
  body: chargeBody(runId),
});
const order = Order.parse(expectOk(firstRes));
const capture = firstCapture(order);
console.log(
  `② charge: HTTP ${firstRes.status}, order ${order.id} ${order.status}, capture ${capture.id} $${capture.amount.value}`,
);
check(
  order.status === "COMPLETED",
  "vaulted charge completed with no buyer popup",
);

// ③ Replay R1: idempotent iff PayPal hands back the same order.
const replayRes = await paypal(token, "POST", "/v2/checkout/orders", {
  requestId: r1,
  body: chargeBody(runId),
});
const replay = Order.parse(expectOk(replayRes));
console.log(
  `③ replay same request id: HTTP ${replayRes.status}, order ${replay.id}`,
);
check(replay.id === order.id, "replay returned the SAME order id");
check(
  capturesOf(replay)[0]?.id === capture.id,
  "replay returned the SAME capture id",
);

// ④ Negative control: new request id must create a new order, or the check above proves nothing.
const controlRes = await paypal(token, "POST", "/v2/checkout/orders", {
  requestId: newRequestId(),
  body: chargeBody(`${runId}:control`),
});
const control = Order.parse(expectOk(controlRes));
const controlCapture = firstCapture(control);
console.log(
  `④ control new request id: HTTP ${controlRes.status}, order ${control.id}`,
);
check(control.id !== order.id, "new request id created a DIFFERENT order");
expectOk(
  await paypal(
    token,
    "POST",
    `/v2/payments/captures/${controlCapture.id}/refund`,
    {
      requestId: newRequestId(),
      body: {},
    },
  ),
);
console.log(`   control capture ${controlCapture.id} fully refunded`);

// ⑤ Ground truth: read the order back from PayPal.
const truth = await getOrder(token, order.id);
const truthCaptures = capturesOf(truth);
console.log(
  `⑤ GET order ${truth.id}: ${truth.status}, captures: ${truthCaptures.map((c) => `${c.id} ${c.status} $${c.amount.value}`).join(", ")}`,
);
check(truthCaptures.length === 1, "exactly one capture on the order");
check(truthCaptures[0]?.amount.value === "17.49", "captured amount is $17.49");

// ⑥ Refund partially, then the rest (empty body).
const partial = RefundResponse.parse(
  expectOk(
    await paypal(token, "POST", `/v2/payments/captures/${capture.id}/refund`, {
      requestId: newRequestId(),
      body: {
        amount: { currency_code: "USD", value: "9.00" },
        note_to_payer: "Crash Test spike partial refund",
      },
    }),
  ),
);
console.log(
  `⑥ partial refund: ${partial.id} ${partial.status} $${partial.amount?.value ?? "?"}`,
);
const rest = RefundResponse.parse(
  expectOk(
    await paypal(token, "POST", `/v2/payments/captures/${capture.id}/refund`, {
      requestId: newRequestId(),
      body: {},
    }),
  ),
);
console.log(
  `   remaining refund: ${rest.id} ${rest.status} $${rest.amount?.value ?? "?"}`,
);

const after = await getOrder(token, order.id);
console.log(
  `   GET order after refunds: capture ${capturesOf(after)[0]?.status ?? "?"}, refunds: ${
    refundsOf(after)
      .map((r) => `${r.id} ${r.status} $${r.amount?.value ?? "?"}`)
      .join(", ") || "(none listed on order)"
  }`,
);

console.log(
  `\nids: order ${order.id}, capture ${capture.id}, refunds ${partial.id} ${rest.id}, control order ${control.id}`,
);
if (failed) {
  console.log("\nSpike finished with FAILURES (see above).");
  process.exitCode = 1;
} else {
  console.log("\nSpike passed.");
}
