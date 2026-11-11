# PayPal sandbox setup

Crash Test only ever talks to the PayPal **sandbox** (`https://api-m.sandbox.paypal.com`). No real money moves.

## 1. Accounts and app

Your normal PayPal login gets you into the developer dashboard. Everything below is created inside the sandbox.

1. Log in at <https://developer.paypal.com> and switch to **Sandbox**.
2. **Testing Tools → Sandbox Accounts:** create one **Business** account (the merchant) and one **Personal** account (the buyer), both with country **United States**. Give the personal account a USD balance. **The default sandbox accounts use your own country; for a non-US developer they fail USD checkout** with "This seller doesn't accept payments in your currency" (verified with India accounts).
3. **Apps & Credentials → Create App** (Merchant), linked to the **US** sandbox business account. An app only takes payments for the business account it is linked to, so an app tied to a non-US account must be replaced.
4. In the app's features, enable vaulting / saving payment methods if the option is shown.
5. `cp .env.example .env` and fill in `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Never commit `.env`.

## 2. Vault the buyer wallet (once)

```sh
pnpm spike:vault
```

The script prints an approval link. Open it, log in as the **sandbox personal** account, and approve. The script polls PayPal until the order is `APPROVED`, captures the $1.00 setup order, and prints `WALLET_VAULT_ID=...`. Put that line into `.env`.

## 3. Run the spike

```sh
pnpm spike
```

It charges $17.49 to the vaulted wallet, replays the same `PayPal-Request-Id` and compares order ids, sends a control charge with a new request id, reads the order back, then refunds $9.00 and the remainder. Exit code 1 means a check failed.

## Findings (first real run, 2026-11-12)

Option A (vaulted PayPal wallet) works. No fallback needed.

| Step                                        | Observed                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vault order create                          | `PAYER_ACTION_REQUIRED`, approval link rel `payer-action` (`/checkoutnow?token=<order id>`).                           |
| Buyer approval                              | Order status goes `PAYER_ACTION_REQUIRED` → `APPROVED`; polling `GET /v2/checkout/orders/{id}` detects it.             |
| Vault capture                               | Order `COMPLETED`; `payment_source.paypal.attributes.vault.status` was already `VAULTED` (no wait needed in this run). |
| Charge with `vault_id`                      | **HTTP 201**, order `COMPLETED` immediately, one capture. No buyer popup.                                              |
| Replay, same `PayPal-Request-Id`            | **HTTP 200** (not 201), same order id and same capture id. Treat any 2xx as success.                                   |
| New `PayPal-Request-Id`, same body          | HTTP 201, a different order id (a real second charge).                                                                 |
| `GET` order                                 | `purchase_units[0].payments.captures[]` has id, status, amount as ARCHITECTURE 7.6 says.                               |
| Partial refund `{amount}`                   | Refund `COMPLETED` for that amount.                                                                                    |
| Refund with empty body `{}` after a partial | Refunds exactly the remaining amount ($17.49 − $9.00 = $8.49).                                                         |
| `GET` order after refunds                   | Capture status `REFUNDED`; refunds listed under `purchase_units[0].payments.refunds[]`.                                |

Failure seen during setup: sandbox accounts with country IN → checkout page error "This seller doesn't accept payments in your currency" (and earlier a generic "Things don't appear to be working"). Fixed by US business and personal accounts plus a new app linked to the US business account.
