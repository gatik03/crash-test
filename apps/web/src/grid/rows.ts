import type { Run, ScenarioRun, SuiteSummary } from "@crash-test/shared";
import { chipFor, worse, type Chip } from "../lib/verdict";

export type MatrixCell = {
  chip: Chip;
  /** The worst trial, opened when the cell is selected. */
  scenarioRunId: string;
  passed: number;
  trials: number;
};

export type MatrixRow = {
  scenario_id: string;
  title: string;
  severity: string;
  cells: Record<string, MatrixCell>;
};

/** Profile order from the run config, falling back to the order seen in scenario runs. */
export function profileIds(run: Run, srs: readonly ScenarioRun[]): string[] {
  const fromConfig = run.config.profile_ids;
  if (
    Array.isArray(fromConfig) &&
    fromConfig.every((p) => typeof p === "string")
  )
    return fromConfig;
  return [...new Set(srs.map((s) => s.profile_id))];
}

/** Rows = scenarios, one cell per profile with the worst-of verdict across trials. */
export function buildMatrixRows(
  srs: readonly ScenarioRun[],
  scenarios: SuiteSummary["scenarios"] = [],
): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const sr of [...srs].sort((a, b) =>
    a.scenario_id.localeCompare(b.scenario_id),
  )) {
    let row = rows.get(sr.scenario_id);
    if (!row) {
      const meta = scenarios.find((s) => s.id === sr.scenario_id);
      row = {
        scenario_id: sr.scenario_id,
        title: meta?.title ?? "",
        severity: meta?.severity ?? "",
        cells: {},
      };
      rows.set(sr.scenario_id, row);
    }
    const chip = chipFor(sr.verdict, sr.status);
    const prev = row.cells[sr.profile_id];
    const passed = chip.kind === "PASS" ? 1 : 0;
    const keepPrev =
      prev && worse(prev.chip.kind, chip.kind) === prev.chip.kind;
    row.cells[sr.profile_id] = {
      chip: keepPrev ? prev.chip : chip,
      scenarioRunId: keepPrev ? prev.scenarioRunId : sr.id,
      passed: (prev?.passed ?? 0) + passed,
      trials: (prev?.trials ?? 0) + 1,
    };
  }
  return [...rows.values()];
}

/** "2/3" when K > 1, else empty. */
export const passRate = (c: MatrixCell): string =>
  c.trials > 1 ? `${c.passed}/${c.trials}` : "";

/** Plain-text cell value, used for change flash, quick filter and CSV export. */
export const cellText = (c: MatrixCell | undefined): string =>
  c ? [c.chip.label, passRate(c)].filter(Boolean).join(" ") : "";
