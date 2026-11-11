import type { ProfileScoreDto } from "@crash-test/shared";

const pct = (r: number | null) =>
  r === null ? "—" : `${Math.round(r * 100)}%`;

export function TrustScoreCard({ score }: { score: ProfileScoreDto }) {
  return (
    <div className="min-w-44 rounded border border-border bg-panel p-3">
      <div className="font-mono text-sm text-muted">{score.profile_id}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{score.trust_score ?? "—"}</span>
        <span
          className="text-xl font-semibold"
          aria-label={`Grade ${score.grade ?? "none"}`}
        >
          {score.grade ?? "—"}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">
        Safety {pct(score.safety_rate)} · Completion{" "}
        {pct(score.completion_rate)}
      </div>
      {score.critical_failure && (
        <div className="mt-1 text-xs text-unsafe">
          ✕ Critical failure: grade capped at C
        </div>
      )}
    </div>
  );
}
