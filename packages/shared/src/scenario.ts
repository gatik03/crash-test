import { z } from "zod";
import { fromPayPalValue } from "./money.js";

/**
 * USD amount as written in YAML (`20.00`, `7.5` or `"17.49"`), converted to integer cents.
 * YAML numbers go through `String()` (shortest exact decimal form), then the strict
 * string parser; no float arithmetic, and more than 2 decimals is rejected.
 */
export const DecimalMoney = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    try {
      return fromPayPalValue(String(v), "USD");
    } catch {
      ctx.addIssue({ code: "custom", message: `Invalid USD amount: ${v}` });
      return z.NEVER;
    }
  });

export const Severity = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof Severity>;

export const AssertionCategory = z.enum(["safety", "task"]);
export type AssertionCategory = z.infer<typeof AssertionCategory>;

/** PRD 7.2. */
export const Policy = z.strictObject({
  budget_total: DecimalMoney,
  restricted_categories: z.array(z.string()).default([]),
  approval_required_over: DecimalMoney.optional(),
  clarify_when_ambiguous: z.boolean().default(false),
  max_quantity_per_item: z.number().int().positive().default(3),
});
export type Policy = z.infer<typeof Policy>;

/** Exact params are validated later by the Shop's `FaultConfig` (shop/faults.ts). */
export const FaultSpec = z.looseObject({ type: z.string() });
export type FaultSpec = z.infer<typeof FaultSpec>;

export const Slot = z.strictObject({
  id: z.string(),
  kind: z.literal("injection"),
  goal: z.string(),
  seed_text: z.string().min(1),
});
export type Slot = z.infer<typeof Slot>;

export const ExpectedItem = z.strictObject({
  product_id: z.string(),
  qty: z.number().int().positive(),
});
export type ExpectedItem = z.infer<typeof ExpectedItem>;

const safety = { category: z.literal("safety") };

/** ARCHITECTURE 5.5 assertion table. */
export const AssertionSpec = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("net_captured_lte"),
    ...safety,
    max: DecimalMoney,
  }),
  z.strictObject({
    type: z.literal("capture_count_lte"),
    ...safety,
    max: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("no_unrequested_items"),
    ...safety,
    allowed_product_ids: z.array(z.string()).min(1),
  }),
  z.strictObject({
    type: z.literal("no_category"),
    ...safety,
    categories: z.array(z.string()).min(1),
  }),
  z.strictObject({
    type: z.literal("approval_precedes_charge"),
    ...safety,
    threshold: DecimalMoney,
  }),
  z.strictObject({
    type: z.literal("clarification_precedes_charge"),
    ...safety,
  }),
  z.strictObject({ type: z.literal("no_charge"), ...safety }),
  z.strictObject({
    type: z.literal("overcharge_recovered"),
    ...safety,
    tolerance: DecimalMoney,
  }),
  z.strictObject({
    type: z.literal("items_exact"),
    category: z.literal("task"),
    items: z.array(ExpectedItem).min(1),
  }),
]);
export type AssertionSpec = z.infer<typeof AssertionSpec>;
export type AssertionType = AssertionSpec["type"];

export const ApprovalBehavior = z.enum(["approve", "decline", "approve_exact"]);
export type ApprovalBehavior = z.infer<typeof ApprovalBehavior>;

/** ARCHITECTURE 5.3. */
export const Scenario = z.strictObject({
  id: z.string().regex(/^S\d{2}$/),
  title: z.string(),
  category: z.string(),
  severity: Severity,
  feasible: z.boolean(),
  expected_outcome: z.enum(["complete", "abort_or_escalate"]),
  instruction: z.string().min(1),
  policy: Policy,
  environment: z.strictObject({
    catalog: z.string(),
    faults: z.array(FaultSpec).default([]),
    slots: z.array(Slot).default([]),
  }),
  assertions: z.array(AssertionSpec).min(1),
  /** ask_user replies, keyed by a case-insensitive substring of the question. */
  user_answers: z.record(z.string(), z.string()).default({}),
  approvals: z
    .strictObject({ default: ApprovalBehavior.default("decline") })
    .default({ default: "decline" }),
});
export type Scenario = z.infer<typeof Scenario>;
