import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GoldRunFixture } from "@crash-test/shared";
import type { Db } from "../db/db.js";
import { listEvents, listLedgerEntries } from "../db/repo.js";
import {
  getRun,
  insertAssertionResult,
  insertEvent,
  insertLedgerEntry,
  insertRun,
  insertScenarioRun,
  listAssertionResults,
  listScenarioRuns,
} from "../db/runsRepo.js";

/** Keeps the first character of the local part: `a***@example.com` (AGENTS rule 6). */
export const maskEmails = (s: string): string =>
  s.replace(
    /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "$1***@$2",
  );

/** Loads every `*.json` gold run as `source='fixture'`, `mode='replay'`; runs already present are skipped. */
export function loadFixtures(db: Db, dir: string): number {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return 0;
  }
  let loaded = 0;
  for (const file of files) {
    const parsed = GoldRunFixture.safeParse(
      JSON.parse(readFileSync(join(dir, file), "utf8")),
    );
    if (!parsed.success)
      throw new Error(`Invalid fixture ${file}: ${parsed.error.message}`);
    const f = parsed.data;
    if (getRun(db, f.run.id)) continue;
    db.transaction(() => {
      insertRun(db, { ...f.run, source: "fixture", mode: "replay" });
      for (const sr of f.scenario_runs) insertScenarioRun(db, sr);
      for (const e of f.events) insertEvent(db, e);
      for (const { scenario_run_id, ...e } of f.ledger_entries)
        insertLedgerEntry(db, scenario_run_id, e);
      for (const { scenario_run_id, ...a } of f.assertion_results)
        insertAssertionResult(db, scenario_run_id, a);
      for (const x of f.explanations)
        db.prepare(
          "INSERT OR REPLACE INTO explanations (scenario_run_id, json, model, created_at) VALUES (?, ?, ?, ?)",
        ).run(
          x.scenario_run_id,
          JSON.stringify(x.json ?? null),
          x.model,
          x.created_at,
        );
    })();
    loaded++;
  }
  return loaded;
}

/** A finished run in the gold-run format, payer emails masked. */
export function exportRun(db: Db, runId: string): GoldRunFixture {
  const run = getRun(db, runId);
  if (!run) throw new Error(`no run ${runId}`);
  const scenario_runs = listScenarioRuns(db, runId);
  const explain = db.prepare<
    [string],
    {
      scenario_run_id: string;
      json: string | null;
      model: string | null;
      created_at: string | null;
    }
  >(
    "SELECT scenario_run_id, json, model, created_at FROM explanations WHERE scenario_run_id = ?",
  );
  const fixture = {
    version: 1 as const,
    run,
    scenario_runs,
    events: scenario_runs.flatMap((sr) => listEvents(db, sr.id)),
    ledger_entries: scenario_runs.flatMap((sr) =>
      listLedgerEntries(db, sr.id).map((e) => ({
        scenario_run_id: sr.id,
        ...e,
      })),
    ),
    assertion_results: scenario_runs.flatMap((sr) =>
      listAssertionResults(db, sr.id).map((a) => ({
        scenario_run_id: sr.id,
        ...a,
      })),
    ),
    explanations: scenario_runs.flatMap((sr) =>
      explain.all(sr.id).map((x) => ({
        ...x,
        json: x.json === null ? null : (JSON.parse(x.json) as unknown),
      })),
    ),
  };
  return GoldRunFixture.parse(JSON.parse(maskEmails(JSON.stringify(fixture))));
}

export function writeFixture(
  db: Db,
  runId: string,
  dir: string,
  name = runId,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error("fixture name: letters, digits, _ and - only");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(exportRun(db, runId), null, 2)}\n`);
  return path;
}
