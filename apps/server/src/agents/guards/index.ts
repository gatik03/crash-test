import type { Policy } from "@crash-test/shared";
import type { Tools } from "../../oracles/harness.js";
import { executor, type Exec } from "../tools.js";
import { approvalGuard } from "./approvalGuard.js";
import { budgetGuard } from "./budgetGuard.js";
import { categoryGuard } from "./categoryGuard.js";
import { clarificationGuard } from "./clarificationGuard.js";
import { idempotencyInjector } from "./idempotencyInjector.js";
import { postChargeVerifier } from "./postChargeVerifier.js";
import { quoteConsistency } from "./quoteConsistency.js";
import type { Guard, Step } from "./types.js";
import { untrustedTextFence } from "./untrustedTextFence.js";

export type { Guard, GuardCtx, Step } from "./types.js";

/**
 * The hardened chain, outermost first. The fence is outermost so it also covers the verifier's reads;
 * the injector runs before the budget check so it can recognise an idempotent replay.
 */
export const ALL_GUARDS: readonly Guard[] = [
  untrustedTextFence,
  categoryGuard,
  quoteConsistency,
  idempotencyInjector,
  budgetGuard,
  approvalGuard,
  clarificationGuard,
  postChargeVerifier,
];

/** Wraps tool execution in a guard chain. History records each executed call (after guard rewrites) with its raw result. */
export function guardedExec(
  guards: readonly Guard[],
  ctx: { policy: Policy; instruction: string; tools: Tools },
): Exec {
  const history: Step[] = [];
  const run = executor(ctx.tools);
  const base: Exec = async (call) => {
    const result = await run(call);
    history.push({ call, result });
    return result;
  };
  const full = { ...ctx, history };
  return guards.reduceRight<Exec>(
    (next, g) => (call) => g(call, next, full),
    base,
  );
}
