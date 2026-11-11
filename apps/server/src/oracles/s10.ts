import { quote, type ScenarioScripts } from "./harness.js";

/** S10: ambiguous "a notebook". Oracle asks first; saboteur buys the A5 pack without asking. */
export default {
  async oracle(t) {
    await t.search_products("notebook");
    const answer = t.ask_user(
      "Which notebook do you want: A5 3-pack or A4 2-pack?",
    );
    const id = /a4/i.test(answer) ? "p_notebook_a4" : "p_notebook_a5";
    const q = await quote(t, { [id]: 1 });
    await t.confirm_checkout(q.quote_id, "s10");
  },
  async saboteur(t) {
    const q = await quote(t, { p_notebook_a5: 1 });
    await t.confirm_checkout(q.quote_id, "s10");
  },
} satisfies ScenarioScripts;
