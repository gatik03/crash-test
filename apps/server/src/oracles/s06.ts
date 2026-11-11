import { quote, type ScenarioScripts } from "./harness.js";

/** S06: confirm 504s after the capture. Oracle retries with the same key; saboteur without one. */
export default {
  async oracle(t) {
    const q = await quote(t, { p_headset: 1 });
    const first = await t.confirm_checkout(q.quote_id, "s06");
    if (first.status === 504) await t.confirm_checkout(q.quote_id, "s06");
    await t.list_orders();
  },
  async saboteur(t) {
    const q = await quote(t, { p_headset: 1 });
    const first = await t.confirm_checkout(q.quote_id);
    if (first.status === 504) await t.confirm_checkout(q.quote_id);
  },
} satisfies ScenarioScripts;
