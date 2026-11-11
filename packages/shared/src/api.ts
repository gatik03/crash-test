import { z } from "zod";
import { AppEvent } from "./events.js";
import { AssertionCategory, Severity } from "./scenario.js";

export const HealthResponse = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** AGENTS.md convention for every API error. */
export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

export const RunStatus = z.enum(["queued", "running", "done", "error"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Verdict = z.enum(["PASS", "UNSAFE", "OVER_REFUSAL", "ERROR"]);
export type Verdict = z.infer<typeof Verdict>;

/** `POST /api/runs` body (ARCHITECTURE 11). Replay runs come only from fixtures. */
export const CreateRunRequest = z.strictObject({
  suite_id: z.string().min(1).default("core-v1"),
  profile_ids: z.array(z.string().min(1)).min(1).max(10),
  /** Subset of the suite; all scenarios when omitted. */
  scenario_ids: z
    .array(z.string().regex(/^S\d{2}$/))
    .min(1)
    .optional(),
  trials: z.number().int().min(1).max(5).default(1),
  mode: z.literal("live").default("live"),
  cleanup_refunds: z.boolean().optional(),
});
export type CreateRunRequest = z.input<typeof CreateRunRequest>;

export const CreateRunResponse = z.object({ run_id: z.string() });
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;

export const Run = z.object({
  id: z.string(),
  suite_id: z.string(),
  suite_version: z.string(),
  mode: z.enum(["live", "replay"]),
  source: z.string(),
  trials: z.number().int(),
  status: RunStatus,
  config: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

export const ScenarioRun = z.object({
  id: z.string(),
  run_id: z.string(),
  scenario_id: z.string(),
  profile_id: z.string(),
  trial: z.number().int(),
  status: RunStatus,
  verdict: Verdict.nullable(),
  safety_pass: z.boolean().nullable(),
  task_pass: z.boolean().nullable(),
  termination: z.string().nullable(),
  steps: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  ledger_completeness: z.string().nullable(),
  error: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type ScenarioRun = z.infer<typeof ScenarioRun>;

/** One row of the Money tab; amounts in integer minor units. */
export const LedgerEntryDto = z.object({
  kind: z.enum(["order", "capture", "refund"]),
  paypal_id: z.string(),
  parent_paypal_id: z.string().nullable(),
  amount_minor: z.number().int().nullable(),
  currency: z.string().nullable(),
  status: z.string().nullable(),
});
export type LedgerEntryDto = z.infer<typeof LedgerEntryDto>;

export const AssertionResultDto = z.object({
  assertion_type: z.string(),
  category: AssertionCategory,
  severity: Severity,
  passed: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
  evidence: z.unknown(),
});
export type AssertionResultDto = z.infer<typeof AssertionResultDto>;

export const ProfileScoreDto = z.object({
  profile_id: z.string(),
  safety_rate: z.number().nullable(),
  completion_rate: z.number().nullable(),
  trust_score: z.number().nullable(),
  grade: z.enum(["A", "B", "C", "D", "F"]).nullable(),
  critical_failure: z.boolean(),
});
export type ProfileScoreDto = z.infer<typeof ProfileScoreDto>;

export const RunListResponse = z.object({ runs: z.array(Run) });
export type RunListResponse = z.infer<typeof RunListResponse>;

export const RunDetail = z.object({
  run: Run,
  scenario_runs: z.array(ScenarioRun),
  scores: z.array(ProfileScoreDto),
});
export type RunDetail = z.infer<typeof RunDetail>;

export const ScenarioRunDetail = z.object({
  scenario_run: ScenarioRun,
  events: z.array(AppEvent),
  ledger: z.array(LedgerEntryDto),
  assertions: z.array(AssertionResultDto),
  explanation: z.unknown().nullable(),
});
export type ScenarioRunDetail = z.infer<typeof ScenarioRunDetail>;

export const SuiteSummary = z.object({
  id: z.string(),
  version: z.string(),
  scenarios: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      severity: Severity,
      feasible: z.boolean(),
    }),
  ),
});
export type SuiteSummary = z.infer<typeof SuiteSummary>;

export const ProfileListResponse = z.object({
  profiles: z.array(z.object({ id: z.string(), kind: z.literal("builtin") })),
});
export type ProfileListResponse = z.infer<typeof ProfileListResponse>;

export const ApiHealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  rail: z.enum(["paypal-sandbox", "mock"]),
  demo_mode: z.enum(["local", "public"]),
  live_runs: z.boolean(),
  llm_configured: z.boolean(),
  checks: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
});
export type ApiHealthResponse = z.infer<typeof ApiHealthResponse>;

/** `fixtures/gold-runs/*.json` (ARCHITECTURE 5.8). */
export const GoldRunFixture = z.object({
  version: z.literal(1),
  run: Run,
  scenario_runs: z.array(ScenarioRun),
  events: z.array(AppEvent),
  ledger_entries: z.array(
    LedgerEntryDto.extend({ scenario_run_id: z.string() }),
  ),
  assertion_results: z.array(
    AssertionResultDto.extend({ scenario_run_id: z.string() }),
  ),
  explanations: z
    .array(
      z.object({
        scenario_run_id: z.string(),
        json: z.unknown(),
        model: z.string().nullable(),
        created_at: z.string().nullable(),
      }),
    )
    .default([]),
});
export type GoldRunFixture = z.infer<typeof GoldRunFixture>;
