import {
  CreateRunRequest,
  type AppEvent,
  type LedgerSnapshot,
  type ProfileScoreDto,
  type RefundRequest,
  type Scenario,
  type ScenarioRun,
} from "@crash-test/shared";
import { nanoid } from "nanoid";
import type { RunEventHub } from "../api/sse.js";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import { listEvents, SqliteEventSink } from "../db/repo.js";
import {
  insertRun,
  insertScenarioRun,
  listScenarioRuns,
  setRunStatus,
  updateScenarioRun,
} from "../db/runsRepo.js";
import type { NewEvent } from "../events/sink.js";
import { MockRail } from "../rails/MockRail.js";
import { PayPalClient } from "../rails/paypalClient.js";
import { PayPalSandboxRail } from "../rails/PayPalSandboxRail.js";
import type { Rail } from "../rails/Rail.js";
import type { ShopSessions } from "../shop/session.js";
import { isCaptured } from "./ledger.js";
import { getProfile } from "./profiles.js";
import {
  runScenario,
  type Injector,
  type ReadableSink,
} from "./scenarioRun.js";
import { scoreProfile } from "./scoring.js";
import { worstOf, type Verdict } from "./verdict.js";

export const SUITE_VERSION = "1";

/** Runs at most `n` tasks at once; a finishing task hands its slot to the next waiter. */
export function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < n) active++;
    else await new Promise<void>((r) => waiting.push(r));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** `PAYPAL_RAIL` selects the rail; one instance serves every scenario run. */
export function railFromConfig(config: Config, sink: ReadableSink): Rail {
  if (config.PAYPAL_RAIL === "mock") return new MockRail(sink);
  return new PayPalSandboxRail({
    client: new PayPalClient({
      clientId: config.PAYPAL_CLIENT_ID ?? "",
      clientSecret: config.PAYPAL_CLIENT_SECRET ?? "",
    }),
    vaultId: config.WALLET_VAULT_ID ?? "",
    sink,
  });
}

/** Refunds whatever each capture still holds; runs after the audit snapshot, so assertions never see it (5.7). */
export async function cleanupRefunds(
  rail: Rail,
  sink: ReadableSink,
  scenarioRunId: string,
  snapshot: LedgerSnapshot,
): Promise<void> {
  for (const order of snapshot.orders)
    for (const c of order.captures) {
      if (!isCaptured(c)) continue;
      let refunded = 0;
      for (const r of c.refunds)
        if (r.status === "COMPLETED") refunded += r.amount.minor;
      const remaining = c.amount.minor - refunded;
      if (remaining <= 0) continue;
      const request: RefundRequest = {
        requestId: `cleanup_${c.id}`,
        captureId: c.id,
        amount: { minor: remaining, currency: c.amount.currency },
        reason: "Crash Test cleanup",
      };
      const result = await rail.refund(request);
      sink.append({
        scenarioRunId,
        type: "cleanup.refund",
        payload: { request, result },
      });
    }
}

/** PRD 8 per profile: worst-of over trials per scenario, then the profile score. */
export function scoreRun(
  scenarioRuns: readonly ScenarioRun[],
  scenarios: readonly Scenario[],
): ProfileScoreDto[] {
  const byProfile = new Map<string, Map<string, ScenarioRun[]>>();
  for (const sr of scenarioRuns) {
    const p = byProfile.get(sr.profile_id) ?? new Map<string, ScenarioRun[]>();
    p.set(sr.scenario_id, [...(p.get(sr.scenario_id) ?? []), sr]);
    byProfile.set(sr.profile_id, p);
  }
  return [...byProfile].map(([profile_id, perScenario]) => {
    const runs = [...perScenario].flatMap(([scenarioId, trials]) => {
      const sc = scenarios.find((s) => s.id === scenarioId);
      if (!sc) return [];
      const scored = trials.filter((t) => t.verdict && t.verdict !== "ERROR");
      return [
        {
          verdict: worstOf(trials.map((t): Verdict => t.verdict ?? "ERROR")),
          feasible: sc.feasible,
          severity: sc.severity,
          safetyPassed: scored.every((t) => t.safety_pass === true),
          taskPassed: scored.every((t) => t.task_pass === true),
        },
      ];
    });
    return { profile_id, ...scoreProfile(runs) };
  });
}

type Job = { sr: ScenarioRun; scenario: Scenario };

export type OrchestratorOptions = {
  db: Db;
  app: Injector;
  shopSessions: ShopSessions;
  hub: RunEventHub;
  suites: Readonly<Record<string, readonly Scenario[]>>;
  makeRail: (sink: ReadableSink) => Rail;
  concurrency: number;
  cleanupRefundsDefault: boolean;
};

/** Run expansion, queue and state machine (ARCHITECTURE 5.7): queued → running → done | error. */
export class Orchestrator {
  readonly rail: Rail;
  private readonly sink: ReadableSink;
  private readonly runIdOf = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly queue;

  constructor(private readonly o: OrchestratorOptions) {
    const inner = new SqliteEventSink(o.db);
    const runIdOf = this.runIdOf;
    // Every stored event is also pushed to the run's SSE channel.
    this.sink = {
      append(e: NewEvent): AppEvent {
        const stored = inner.append(e);
        const runId = runIdOf.get(e.scenarioRunId);
        if (runId) o.hub.publish(runId, stored.type, stored);
        return stored;
      },
      for: (id) => listEvents(o.db, id),
    };
    this.rail = o.makeRail(this.sink);
    this.queue = limiter(o.concurrency);
  }

  /** Validated request in, run id out; the run proceeds in the background. */
  createRun(input: unknown): string {
    const req = CreateRunRequest.parse(input);
    const suite = this.o.suites[req.suite_id];
    if (!suite) throw new OrchestratorError("unknown_suite", req.suite_id);
    for (const p of req.profile_ids)
      if (!getProfile(p)) throw new OrchestratorError("unknown_profile", p);
    const scenarios = req.scenario_ids
      ? req.scenario_ids.map((id) => {
          const s = suite.find((x) => x.id === id);
          if (!s) throw new OrchestratorError("unknown_scenario", id);
          return s;
        })
      : suite;

    const runId = `run_${nanoid()}`;
    const now = new Date().toISOString();
    const cleanup = req.cleanup_refunds ?? this.o.cleanupRefundsDefault;
    const jobs: Job[] = [];
    this.o.db.transaction(() => {
      insertRun(this.o.db, {
        id: runId,
        suite_id: req.suite_id,
        suite_version: SUITE_VERSION,
        mode: "live",
        source: "live",
        trials: req.trials,
        status: "queued",
        config: {
          profile_ids: req.profile_ids,
          scenario_ids: scenarios.map((s) => s.id),
          cleanup_refunds: cleanup,
          rail: this.rail.kind,
        },
        created_at: now,
        finished_at: null,
      });
      for (const scenario of scenarios)
        for (const profile_id of req.profile_ids)
          for (let trial = 1; trial <= req.trials; trial++) {
            const sr: ScenarioRun = {
              id: `sr_${nanoid()}`,
              run_id: runId,
              scenario_id: scenario.id,
              profile_id,
              trial,
              status: "queued",
              verdict: null,
              safety_pass: null,
              task_pass: null,
              termination: null,
              steps: null,
              tokens_in: null,
              tokens_out: null,
              ledger_completeness: null,
              error: null,
              started_at: null,
              finished_at: null,
            };
            insertScenarioRun(this.o.db, sr);
            jobs.push({ sr, scenario });
          }
    })();
    for (const j of jobs) this.runIdOf.set(j.sr.id, runId);
    this.pending.set(runId, this.execute(runId, jobs, cleanup, suite));
    return runId;
  }

  /** Resolves when the run has reached done or error. */
  wait(runId: string): Promise<void> {
    return this.pending.get(runId) ?? Promise.resolve();
  }

  private async execute(
    runId: string,
    jobs: Job[],
    cleanup: boolean,
    suite: readonly Scenario[],
  ): Promise<void> {
    const { db, hub } = this.o;
    setRunStatus(db, runId, "running");
    hub.publish(runId, "run.started", {
      run_id: runId,
      scenario_runs: jobs.map((j) => j.sr.id),
    });
    let status: "done" | "error" = "done";
    try {
      await Promise.all(
        jobs.map((j) => this.queue(() => this.runOne(j, cleanup))),
      );
    } catch {
      status = "error";
    }
    setRunStatus(db, runId, status, new Date().toISOString());
    hub.publish(runId, "run.finished", {
      run_id: runId,
      status,
      scores: scoreRun(listScenarioRuns(db, runId), suite),
    });
  }

  private async runOne({ sr, scenario }: Job, cleanup: boolean) {
    const { db } = this.o;
    const id = sr.id;
    updateScenarioRun(db, id, {
      status: "running",
      started_at: new Date().toISOString(),
    });
    this.sink.append({
      scenarioRunId: id,
      type: "scenario.started",
      payload: {
        run_id: sr.run_id,
        scenario_id: sr.scenario_id,
        profile_id: sr.profile_id,
        trial: sr.trial,
      },
    });
    let patch: Partial<ScenarioRun>;
    try {
      const factory = getProfile(sr.profile_id);
      if (!factory) throw new Error(`unknown profile ${sr.profile_id}`);
      const { audit, stats, error } = await runScenario({
        scenario,
        agent: factory(scenario),
        rail: this.rail,
        sink: this.sink,
        scenarioRunId: id,
        shopSessions: this.o.shopSessions,
        app: this.o.app,
        db,
      });
      patch = {
        status: error === undefined ? "done" : "error",
        verdict: audit.verdict,
        safety_pass: audit.results.every(
          (r) => r.category !== "safety" || r.passed,
        ),
        task_pass: audit.results.every(
          (r) => r.category !== "task" || r.passed,
        ),
        termination: stats.termination,
        steps: stats.steps,
        tokens_in: stats.tokensIn,
        tokens_out: stats.tokensOut,
        ledger_completeness: audit.snapshot.ledger_completeness ?? "ok",
        error: error ?? null,
      };
      try {
        if (cleanup)
          await cleanupRefunds(this.rail, this.sink, id, audit.snapshot);
      } catch (e) {
        // The verdict stands; leftover captured money must be visible.
        patch = {
          ...patch,
          status: "error",
          error: `cleanup refund failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    } catch (e) {
      patch = {
        status: "error",
        verdict: "ERROR",
        error: e instanceof Error ? e.message : String(e),
      };
    }
    patch.finished_at = new Date().toISOString();
    updateScenarioRun(db, id, patch);
    this.sink.append({
      scenarioRunId: id,
      type: "scenario.finished",
      payload: {
        run_id: sr.run_id,
        scenario_id: sr.scenario_id,
        profile_id: sr.profile_id,
        trial: sr.trial,
        status: patch.status,
        verdict: patch.verdict,
        ...(patch.error && { error: patch.error }),
      },
    });
  }
}

export class OrchestratorError extends Error {
  constructor(
    readonly code: "unknown_suite" | "unknown_profile" | "unknown_scenario",
    detail: string,
  ) {
    super(`${code.replace("_", " ")}: ${detail}`);
    this.name = "OrchestratorError";
  }
}
