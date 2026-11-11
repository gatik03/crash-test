// One-time helper: vault the sandbox buyer's PayPal wallet (ARCHITECTURE 7.4).
// Run: pnpm spike:vault   Then put the printed WALLET_VAULT_ID into .env.
import {
  expectOk,
  getOrder,
  getToken,
  loadEnv,
  maskEmail,
  newRequestId,
  Order,
  paypal,
  sleep,
  vaultOf,
} from "./paypal-spike-lib.ts";

const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const APPROVAL_POLL_MS = 3_000;

const env = loadEnv();
const token = await getToken(env);
console.log("token: ok");

const created = Order.parse(
  expectOk(
    await paypal(token, "POST", "/v2/checkout/orders", {
      requestId: newRequestId(),
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "wallet-setup",
            amount: { currency_code: "USD", value: "1.00" },
          },
        ],
        payment_source: {
          paypal: {
            attributes: {
              vault: {
                store_in_vault: "ON_SUCCESS",
                usage_type: "MERCHANT",
                customer_type: "CONSUMER",
              },
            },
            experience_context: {
              // The script polls PayPal for approval, so where the browser lands doesn't matter.
              return_url: "https://example.com/crash-test/setup/return",
              cancel_url: "https://example.com/crash-test/setup/cancel",
              user_action: "PAY_NOW",
            },
          },
        },
      },
    }),
  ),
);
console.log(`order: ${created.id} ${created.status}`);

const link = created.links?.find(
  (l) => l.rel === "payer-action" || l.rel === "approve",
);
if (!link)
  throw new Error(
    `No approval link in the response (order status ${created.status}).`,
  );

console.log(
  `\nOpen this link, log in as your SANDBOX PERSONAL account, and approve:\n\n  ${link.href}\n`,
);
console.log(
  "Waiting for approval: polling PayPal every 3 s for up to 10 min...",
);

// Ground truth decides when the buyer is done, not a keypress.
const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
let status = created.status;
while (status !== "APPROVED") {
  if (Date.now() > deadline)
    throw new Error(`Timed out waiting for approval (last status ${status}).`);
  await sleep(APPROVAL_POLL_MS);
  const next = (await getOrder(token, created.id)).status;
  if (next !== status) console.log(`status: ${status} → ${next}`);
  status = next;
}

const captured = Order.parse(
  expectOk(
    await paypal(token, "POST", `/v2/checkout/orders/${created.id}/capture`, {
      requestId: newRequestId(),
      body: {},
    }),
  ),
);
console.log(`capture: order ${captured.id} ${captured.status}`);

// The vault can briefly report APPROVED before VAULTED (ARCHITECTURE 7.4 step 4).
let order = captured;
for (let i = 0; vaultOf(order)?.status !== "VAULTED" && i < 15; i++) {
  await sleep(2_000);
  order = await getOrder(token, created.id);
}

const vault = vaultOf(order);
if (!vault?.id)
  throw new Error(
    "No vault id on the captured order. Vaulting may not be enabled for this app.",
  );
console.log(`\nvault status: ${vault.status ?? "?"}`);
console.log(`payer: ${maskEmail(order.payment_source?.paypal?.email_address)}`);
console.log(`\nAdd this line to .env:\n\n  WALLET_VAULT_ID=${vault.id}\n`);
if (vault.status !== "VAULTED")
  console.warn("Warning: vault not VAULTED after 30 s; the charge may fail.");
