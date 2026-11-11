import type { AssertionResultDto } from "@crash-test/shared";
import { formatValue } from "../lib/money";

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
        {formatValue(value)}
      </pre>
    </div>
  );
}

export function AssertionList({
  assertions,
}: {
  assertions: AssertionResultDto[];
}) {
  if (assertions.length === 0)
    return <p className="text-sm text-muted">No assertion results yet.</p>;
  return (
    <ul className="space-y-2">
      {assertions.map((a, i) => (
        <li key={i} className="rounded border border-border bg-raised p-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded border px-2 py-0.5 font-mono text-xs font-semibold ${
                a.passed
                  ? "border-pass/50 text-pass"
                  : "border-unsafe/50 text-unsafe"
              }`}
            >
              <span aria-hidden="true">{a.passed ? "✓ " : "✕ "}</span>
              {a.passed ? "PASS" : "FAIL"}
            </span>
            <span className="font-mono">{a.assertion_type}</span>
            <span className="text-xs text-muted">
              {a.category} · {a.severity}
            </span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <Field label="Expected" value={a.expected} />
            <Field label="Actual" value={a.actual} />
            <Field label="Evidence" value={a.evidence} />
          </div>
        </li>
      ))}
    </ul>
  );
}
