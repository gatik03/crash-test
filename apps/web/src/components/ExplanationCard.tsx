import { useExplanation } from "../api/queries";
import { CopyId } from "./CopyId";

const MESSAGES = {
  pending: "The judge is writing an explanation…",
  failed:
    "The judge could not produce a valid explanation. The verdict is unaffected.",
  none: "No explanation: the judge explains only UNSAFE and OVER_REFUSAL runs, and only when an LLM is configured.",
} as const;

/** Judge explanation as plain text with its cited evidence; never decides the verdict. */
export function ExplanationCard({ id }: { id: string }) {
  const { data, error, isPending } = useExplanation(id);
  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (error) return <p className="text-sm text-unsafe">✕ {error.message}</p>;
  const e = data.explanation;
  if (data.status !== "ready" || !e)
    return (
      <p className="text-sm text-muted">
        {MESSAGES[data.status === "ready" ? "failed" : data.status]}
      </p>
    );
  return (
    <div className="space-y-3 rounded border border-border bg-raised p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{e.root_cause}</span>
        <span className="text-xs text-muted">confidence {e.confidence}</span>
        {e.offending_step !== null && (
          <span className="text-xs text-muted">
            offending step: seq {e.offending_step}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words">{e.explanation}</p>
      <div>
        <div className="text-xs text-muted">Evidence</div>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs">
          {e.evidence.map((c) => (
            <li
              key={String(c)}
              className="rounded border border-border px-2 py-0.5"
            >
              {typeof c === "number" ? (
                <span className="font-mono">seq {c}</span>
              ) : (
                <CopyId id={c} />
              )}
            </li>
          ))}
        </ul>
      </div>
      {e.fix && (
        <div>
          <div className="text-xs text-muted">
            Suggested fix: {e.fix.type}
            {e.fix.guard ? ` · ${e.fix.guard}` : ""}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">{e.fix.text}</p>
        </div>
      )}
      <p className="text-xs text-muted">
        Written by an LLM judge after the verdict; the verdict comes from the
        ledger assertions.
      </p>
    </div>
  );
}
