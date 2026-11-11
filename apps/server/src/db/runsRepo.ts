import {
  AssertionResultDto,
  Run,
  ScenarioRun,
  type AppEvent,
  type LedgerEntryDto,
} from "@crash-test/shared";
import type { Db } from "./db.js";

type RunRow = Omit<Run, "config"> & { config_json: string };
type ScenarioRunRow = Omit<ScenarioRun, "safety_pass" | "task_pass"> & {
  safety_pass: number | null;
  task_pass: number | null;
};

const bool = (v: number | null) => (v === null ? null : v === 1);
const int = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

const toRun = ({ config_json, ...r }: RunRow): Run =>
  Run.parse({ ...r, config: JSON.parse(config_json) as unknown });

const toScenarioRun = (r: ScenarioRunRow): ScenarioRun =>
  ScenarioRun.parse({
    ...r,
    safety_pass: bool(r.safety_pass),
    task_pass: bool(r.task_pass),
  });

const SR_COLS =
  "id, run_id, scenario_id, profile_id, trial, status, verdict, safety_pass, task_pass, termination, steps, tokens_in, tokens_out, ledger_completeness, error, started_at, finished_at";

export function insertRun(db: Db, r: Run): void {
  db.prepare(
    `INSERT INTO runs (id, suite_id, suite_version, mode, source, trials, status, config_json, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id,
    r.suite_id,
    r.suite_version,
    r.mode,
    r.source,
    r.trials,
    r.status,
    JSON.stringify(r.config),
    r.created_at,
    r.finished_at,
  );
}

export function insertScenarioRun(db: Db, s: ScenarioRun): void {
  db.prepare(
    `INSERT INTO scenario_runs (${SR_COLS}) VALUES (${SR_COLS.split(",")
      .map(() => "?")
      .join(", ")})`,
  ).run(
    s.id,
    s.run_id,
    s.scenario_id,
    s.profile_id,
    s.trial,
    s.status,
    s.verdict,
    int(s.safety_pass),
    int(s.task_pass),
    s.termination,
    s.steps,
    s.tokens_in,
    s.tokens_out,
    s.ledger_completeness,
    s.error,
    s.started_at,
    s.finished_at,
  );
}

export function updateScenarioRun(
  db: Db,
  id: string,
  patch: Partial<Omit<ScenarioRun, "id" | "run_id">>,
): void {
  const entries = Object.entries(patch).map(([k, v]): [string, unknown] => [
    k,
    typeof v === "boolean" ? int(v) : v,
  ]);
  if (entries.length === 0) return;
  // Keys are ScenarioRun field names (typed), never user input.
  db.prepare(
    `UPDATE scenario_runs SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run(...entries.map(([, v]) => v), id);
}

export function setRunStatus(
  db: Db,
  id: string,
  status: Run["status"],
  finishedAt: string | null = null,
): void {
  db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(
    status,
    finishedAt,
    id,
  );
}

export function getRun(db: Db, id: string): Run | null {
  const r = db
    .prepare<[string], RunRow>("SELECT * FROM runs WHERE id = ?")
    .get(id);
  return r ? toRun(r) : null;
}

export function listRuns(db: Db, limit = 100): Run[] {
  return db
    .prepare<[number], RunRow>(
      "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit)
    .map(toRun);
}

export function listScenarioRuns(db: Db, runId: string): ScenarioRun[] {
  return db
    .prepare<[string], ScenarioRunRow>(
      `SELECT ${SR_COLS} FROM scenario_runs WHERE run_id = ? ORDER BY scenario_id, profile_id, trial`,
    )
    .all(runId)
    .map(toScenarioRun);
}

export function getScenarioRun(db: Db, id: string): ScenarioRun | null {
  const r = db
    .prepare<[string], ScenarioRunRow>(
      `SELECT ${SR_COLS} FROM scenario_runs WHERE id = ?`,
    )
    .get(id);
  return r ? toScenarioRun(r) : null;
}

type AssertionRow = {
  assertion_type: string;
  category: string;
  severity: string;
  passed: number;
  expected_json: string | null;
  actual_json: string | null;
  evidence_json: string | null;
};

const parse = (v: string | null): unknown =>
  v === null ? null : (JSON.parse(v) as unknown);

export function listAssertionResults(
  db: Db,
  scenarioRunId: string,
): AssertionResultDto[] {
  return db
    .prepare<[string], AssertionRow>(
      "SELECT assertion_type, category, severity, passed, expected_json, actual_json, evidence_json FROM assertion_results WHERE scenario_run_id = ? ORDER BY id",
    )
    .all(scenarioRunId)
    .map((r) =>
      AssertionResultDto.parse({
        assertion_type: r.assertion_type,
        category: r.category,
        severity: r.severity,
        passed: r.passed === 1,
        expected: parse(r.expected_json),
        actual: parse(r.actual_json),
        evidence: parse(r.evidence_json),
      }),
    );
}

export function insertAssertionResult(
  db: Db,
  scenarioRunId: string,
  a: AssertionResultDto,
): void {
  db.prepare(
    `INSERT INTO assertion_results (scenario_run_id, assertion_type, category, severity, passed, expected_json, actual_json, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scenarioRunId,
    a.assertion_type,
    a.category,
    a.severity,
    a.passed ? 1 : 0,
    JSON.stringify(a.expected ?? null),
    JSON.stringify(a.actual ?? null),
    JSON.stringify(a.evidence ?? null),
  );
}

export function insertLedgerEntry(
  db: Db,
  scenarioRunId: string,
  e: LedgerEntryDto,
): void {
  db.prepare(
    `INSERT INTO ledger_entries (scenario_run_id, kind, paypal_id, parent_paypal_id, amount_minor, currency, status, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scenarioRunId,
    e.kind,
    e.paypal_id,
    e.parent_paypal_id,
    e.amount_minor,
    e.currency,
    e.status,
    new Date().toISOString(),
  );
}

/** Stored as-is (seq and ts kept), for fixtures. */
export function insertEvent(db: Db, e: AppEvent): void {
  db.prepare(
    "INSERT INTO events (scenario_run_id, seq, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
  ).run(e.scenarioRunId, e.seq, e.ts, e.type, JSON.stringify(e.payload));
}

export function getExplanation(db: Db, scenarioRunId: string): unknown {
  const r = db
    .prepare<[string], { json: string | null }>(
      "SELECT json FROM explanations WHERE scenario_run_id = ?",
    )
    .get(scenarioRunId);
  return r ? parse(r.json) : null;
}

/** Boot recovery (ARCHITECTURE 5.7): the in-memory queue is gone, so nothing non-terminal can finish. */
export function recoverStuckRuns(db: Db): number {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const sr = db
      .prepare(
        "UPDATE scenario_runs SET status = 'error', verdict = 'ERROR', error = 'server restarted mid-run', finished_at = ? WHERE status IN ('queued', 'running')",
      )
      .run(now).changes;
    const r = db
      .prepare(
        "UPDATE runs SET status = 'error', finished_at = ? WHERE status IN ('queued', 'running')",
      )
      .run(now).changes;
    return sr + r;
  })();
}
