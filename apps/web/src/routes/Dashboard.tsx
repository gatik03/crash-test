import { Link } from "react-router-dom";
import { useRunDetails, useRuns } from "../api/queries";
import { HealthBadges } from "../components/HealthBadges";

const RECENT = 10;

export function Dashboard() {
  const runs = useRuns();
  const list = runs.data?.runs ?? [];
  const recent = list.slice(0, RECENT);
  const details = useRunDetails(recent.map((r) => r.id));
  const gold = list.find((r) => r.mode === "replay");

  return (
    <div className="space-y-6">
      <section aria-labelledby="health-h" className="space-y-2">
        <h1 id="health-h" className="text-xl font-semibold">
          Dashboard
        </h1>
        <HealthBadges />
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/runs/new"
          className="rounded bg-accent px-4 py-2 font-semibold text-bg"
        >
          Run suite
        </Link>
        {gold ? (
          <Link
            to={`/runs/${gold.id}`}
            className="rounded border border-border px-4 py-2 hover:bg-raised"
          >
            Open recorded gold run
          </Link>
        ) : (
          <span className="px-4 py-2 text-sm text-muted">
            No recorded gold run loaded
          </span>
        )}
      </div>

      <section aria-labelledby="runs-h" className="space-y-2">
        <h2 id="runs-h" className="text-lg font-semibold">
          Recent runs
        </h2>
        {runs.isPending && <p className="text-sm text-muted">Loading runs…</p>}
        {runs.error && (
          <p className="text-sm text-unsafe">✕ {runs.error.message}</p>
        )}
        {runs.data && list.length === 0 && (
          <p className="text-sm text-muted">
            No runs yet. Start one with "Run suite".
          </p>
        )}
        {recent.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-normal">Run</th>
                <th className="font-normal">Mode</th>
                <th className="font-normal">Status</th>
                <th className="font-normal">Profiles: Trust Score (grade)</th>
                <th className="font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1.5 font-mono">
                    <Link
                      to={`/runs/${r.id}`}
                      className="text-accent hover:underline"
                    >
                      {r.id}
                    </Link>
                  </td>
                  <td>{r.mode === "replay" ? "REPLAY" : "live"}</td>
                  <td>{r.status}</td>
                  <td className="font-mono">
                    {details[i]?.data?.scores
                      .map(
                        (s) =>
                          `${s.profile_id}: ${s.trust_score ?? "—"} (${s.grade ?? "—"})`,
                      )
                      .join("  ") ?? "…"}
                  </td>
                  <td className="text-muted">{r.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
