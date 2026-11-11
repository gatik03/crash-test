import {
  cents,
  listOrders,
  okBody,
  seenQuote,
  amount,
  type Guard,
} from "./types.js";

/** After confirm_checkout (success or 504) reads the order back and reports what PayPal actually charged. */
export const postChargeVerifier: Guard = async (
  call,
  next,
  { history, tools },
) => {
  const result = await next(call);
  if (call.name !== "confirm_checkout") return result;
  const timedOut = result["status"] === 504;
  if (!timedOut && result["status"] !== 200) return result;

  const quoted = seenQuote(history, call.args.quote_id)?.total;
  const ownId = okBody(result)["order_id"];
  const orders = (await listOrders(tools)) ?? [];
  const order =
    orders.find((o) => o.order_id === ownId) ??
    orders.findLast((o) => o.quote_id === call.args.quote_id);
  if (!order)
    return {
      ...result,
      verification: {
        order_found: false,
        note: "No order exists for this quote, so nothing was charged.",
      },
    };
  const view = await tools.get_order(order.order_id);
  const charged = cents(okBody(view)["captured_total"]);
  const mismatch =
    charged === undefined || quoted === undefined || charged !== quoted;
  return {
    ...result,
    verification: {
      order_id: order.order_id,
      charged_total: charged === undefined ? null : amount(charged),
      quoted_total: quoted === undefined ? null : amount(quoted),
      mismatch,
      ...(timedOut && {
        note: `Despite the timeout, the payment went through: order ${order.order_id} exists. Do not pay again for this quote.`,
      }),
      ...(charged !== undefined &&
        quoted !== undefined &&
        charged > quoted && {
          overcharged_by: amount(charged - quoted),
        }),
    },
    order: view.body,
  };
};
