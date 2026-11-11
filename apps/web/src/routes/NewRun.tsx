import { CreateRunResponse, type CreateRunRequest } from "@crash-test/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { postJson } from "../api/client";
import { useProfiles, useSuites } from "../api/queries";

const box = "rounded border border-border bg-panel p-4 space-y-2";

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function NewRun() {
  const navigate = useNavigate();
  const suites = useSuites();
  const profiles = useProfiles();
  const [suiteId, setSuiteId] = useState("core-v1");
  const [picked, setPicked] = useState<string[]>([]);
  // null = whole suite
  const [scenarioIds, setScenarioIds] = useState<string[] | null>(null);
  const [trials, setTrials] = useState(1);
  const [cleanup, setCleanup] = useState(true);

  const suite = suites.data?.suites.find((s) => s.id === suiteId);
  const create = useMutation({
    mutationFn: (body: CreateRunRequest) =>
      postJson("/api/runs", body, CreateRunResponse),
    onSuccess: (r) => navigate(`/runs/${r.run_id}`),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      suite_id: suiteId,
      profile_ids: picked,
      ...(scenarioIds && { scenario_ids: scenarioIds }),
      trials,
      mode: "live",
      cleanup_refunds: cleanup,
    });
  };

  const scenarioCount = scenarioIds?.length ?? suite?.scenarios.length ?? 0;
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">New run</h1>

      <label className={`${box} block`}>
        <span className="block text-sm text-muted">Suite</span>
        <select
          value={suiteId}
          onChange={(e) => {
            setSuiteId(e.target.value);
            setScenarioIds(null);
          }}
          className="rounded border border-border bg-raised px-2 py-1"
        >
          {(suites.data?.suites ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} (v{s.version})
            </option>
          ))}
        </select>
      </label>

      <fieldset className={box}>
        <legend className="text-sm text-muted">Profiles (one or more)</legend>
        {profiles.error && (
          <p className="text-sm text-unsafe">✕ {profiles.error.message}</p>
        )}
        <div className="flex flex-wrap gap-4">
          {(profiles.data?.profiles ?? []).map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 font-mono text-sm"
            >
              <input
                type="checkbox"
                checked={picked.includes(p.id)}
                onChange={() => setPicked(toggle(picked, p.id))}
              />
              {p.id}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={box}>
        <legend className="text-sm text-muted">Scenarios</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scenarioIds === null}
            onChange={(e) => setScenarioIds(e.target.checked ? null : [])}
          />
          Whole suite
        </label>
        {scenarioIds !== null && (
          <div className="grid gap-1 sm:grid-cols-2">
            {(suite?.scenarios ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scenarioIds.includes(s.id)}
                  onChange={() => setScenarioIds(toggle(scenarioIds, s.id))}
                />
                <span className="font-mono">{s.id}</span> {s.title}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className={`${box} flex flex-wrap items-center gap-6`}>
        <label className="flex items-center gap-2 text-sm">
          Trials (K)
          <select
            value={trials}
            onChange={(e) => setTrials(Number(e.target.value))}
            className="rounded border border-border bg-raised px-2 py-1"
          >
            {[1, 2, 3].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
          />
          Cleanup refunds after each scenario
        </label>
        <span className="text-sm text-muted">
          Mode: live (recorded runs open from the dashboard)
        </span>
      </div>

      {create.error && (
        <p role="alert" className="text-sm text-unsafe">
          ✕ {create.error.message}
        </p>
      )}
      <button
        type="submit"
        disabled={
          picked.length === 0 || scenarioCount === 0 || create.isPending
        }
        className="rounded bg-accent px-4 py-2 font-semibold text-bg disabled:opacity-50"
      >
        {create.isPending
          ? "Starting…"
          : `Run ${scenarioCount} scenario(s) × ${picked.length} profile(s)`}
      </button>
    </form>
  );
}
