import { useHealth } from "../api/queries";

export function HealthBadges() {
  const { data, error, isPending } = useHealth();
  if (isPending) return <p className="text-sm text-muted">Checking health…</p>;
  if (error)
    return (
      <p className="text-sm text-unsafe">
        ✕ Health check failed: {error.message}
      </p>
    );
  const badges = [
    { name: `Rail: ${data.rail}`, ok: data.status === "ok" },
    { name: "LLM configured", ok: data.llm_configured },
    ...data.checks,
  ];
  return (
    <ul aria-label="Component health" className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <li
          key={b.name}
          title={"detail" in b ? b.detail : undefined}
          className={`rounded border px-2 py-1 font-mono text-xs ${
            b.ok ? "border-pass/50 text-pass" : "border-unsafe/50 text-unsafe"
          }`}
        >
          <span aria-hidden="true">{b.ok ? "✓ " : "✕ "}</span>
          {b.name}
          <span className="sr-only">{b.ok ? " ok" : " failing"}</span>
        </li>
      ))}
    </ul>
  );
}
