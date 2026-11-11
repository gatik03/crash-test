import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useRun, useSuites } from "../api/queries";
import { Banner } from "../components/Header";
import { ScenarioDetail } from "../components/ScenarioDetail";
import { TrustScoreCard } from "../components/TrustScoreCard";
import { buildMatrixRows, profileIds } from "../grid/rows";
import { RunMatrixGrid } from "../grid/RunMatrixGrid";
import { useRunStream } from "../hooks/useRunStream";

export function RunView() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const selected = params.get("sr");
  const { data, error, isPending } = useRun(id);
  const suites = useSuites();
  const status = data?.run.status;
  useRunStream(id, status === "queued" || status === "running");

  const suite = suites.data?.suites.find((s) => s.id === data?.run.suite_id);
  const rows = useMemo(
    () => (data ? buildMatrixRows(data.scenario_runs, suite?.scenarios) : []),
    [data, suite],
  );
  const profiles = useMemo(
    () => (data ? profileIds(data.run, data.scenario_runs) : []),
    [data],
  );

  if (isPending) return <p className="text-muted">Loading run…</p>;
  if (error) return <p className="text-unsafe">✕ {error.message}</p>;

  const { run, scenario_runs, scores } = data;
  const finished = scenario_runs.filter(
    (s) => s.status === "done" || s.status === "error",
  ).length;
  return (
    <div className="space-y-4">
      {run.mode === "replay" && (
        <Banner tone="info">
          REPLAY — recorded run ({run.source}); no live PayPal calls
        </Banner>
      )}
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="font-mono text-xl font-semibold">{run.id}</h1>
        <span className="text-sm text-muted">
          {run.suite_id} v{run.suite_version} · K={run.trials} · {run.status}
        </span>
        <span className="text-sm" aria-live="polite">
          {finished}/{scenario_runs.length} scenario runs finished
        </span>
      </div>
      <progress
        className="h-1.5 w-full accent-accent"
        max={scenario_runs.length || 1}
        value={finished}
        aria-label="Run progress"
      />
      <div className="flex flex-wrap gap-3">
        {scores.map((s) => (
          <TrustScoreCard key={s.profile_id} score={s} />
        ))}
      </div>
      <RunMatrixGrid
        rows={rows}
        profiles={profiles}
        scores={scores}
        onOpen={(sr) => setParams({ sr })}
      />
      {selected && (
        <ScenarioDetail id={selected} onClose={() => setParams({})} />
      )}
    </div>
  );
}
