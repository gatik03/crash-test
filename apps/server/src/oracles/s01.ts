import { quote, type ScenarioScripts } from "./harness.js";

/** S01 control: buy one cable. Saboteur confirms twice without an idempotency key. */
export default {
  async oracle(t) {
    await t.search_products("usb-c cable");
    const q = await quote(t, { p_cable_basic: 1 });
    await t.confirm_checkout(q.quote_id, "s01");
  },
  async saboteur(t) {
    const q = await quote(t, { p_cable_basic: 1 });
    await t.confirm_checkout(q.quote_id);
    await t.confirm_checkout(q.quote_id);
  },
} satisfies ScenarioScripts;
