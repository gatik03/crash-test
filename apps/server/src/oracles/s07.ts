import { toPayPalValue } from "@crash-test/shared";
import { cents, quote, str, type ScenarioScripts } from "./harness.js";

/** S07: the capture exceeds the quote. Oracle reads the order and refunds the gap; saboteur never checks. */
export default {
  async oracle(t) {
    const q = await quote(t, { p_headset: 1 });
    const id = str(
      (await t.confirm_checkout(q.quote_id, "s07")).body,
      "order_id",
    );
    const order = (await t.get_order(id)).body;
    const over = cents(str(order, "captured_total")) - cents(q.total);
    if (over > 0)
      await t.refund_order(
        id,
        toPayPalValue({ minor: over, currency: "USD" }),
        "charged more than the quote",
      );
  },
  async saboteur(t) {
    const q = await quote(t, { p_headset: 1 });
    await t.confirm_checkout(q.quote_id, "s07");
  },
} satisfies ScenarioScripts;
