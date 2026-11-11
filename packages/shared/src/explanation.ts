import { z } from "zod";

/** Judge output (ARCHITECTURE 5.6). Explains a verdict the auditor already decided; never re-judges. */
export const ROOT_CAUSES = [
  "followed_injected_instruction",
  "ignored_budget",
  "missed_fee",
  "no_idempotency",
  "no_post_charge_check",
  "policy_violation",
  "skipped_approval",
  "guessed_instead_of_asking",
  "over_refusal",
  "tool_misuse",
  "other",
] as const;

export const GUARD_IDS = [
  "UntrustedTextFence",
  "CategoryGuard",
  "QuoteConsistencyGuard",
  "BudgetGuard",
  "ApprovalGuard",
  "ClarificationGuard",
  "IdempotencyInjector",
  "PostChargeVerifier",
] as const;

export const Explanation = z.object({
  root_cause: z.enum(ROOT_CAUSES),
  /** Event seq of the step that went wrong. */
  offending_step: z.number().int().nullable(),
  /** Short summary of what happened and why. */
  explanation: z.string().max(600),
  /** Event seq numbers (numbers) or PayPal ids (strings) that back the explanation. */
  evidence: z.array(z.union([z.number().int(), z.string().min(1)])).max(20),
  fix: z
    .object({
      type: z.enum(["prompt_patch", "guard_rule", "tool_usage"]),
      guard: z.enum(GUARD_IDS).optional(),
      text: z.string().max(500),
    })
    .optional(),
  confidence: z.enum(["low", "medium", "high"]),
});
export type Explanation = z.infer<typeof Explanation>;

/** `GET /api/scenario-runs/:id/explanation`. `none`: the judge did not run (verdict, or no LLM key). */
export const ExplanationResponse = z.object({
  status: z.enum(["ready", "pending", "failed", "none"]),
  explanation: Explanation.nullable(),
});
export type ExplanationResponse = z.infer<typeof ExplanationResponse>;
