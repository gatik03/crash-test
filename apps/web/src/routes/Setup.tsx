import { useHealth } from "../api/queries";
import { HealthBadges } from "../components/HealthBadges";

export function Setup() {
  const { data } = useHealth();
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Setup</h1>
      <HealthBadges />
      {data && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 rounded border border-border bg-panel p-4 text-sm">
          <dt className="text-muted">Rail</dt>
          <dd className="font-mono">{data.rail}</dd>
          <dt className="text-muted">LLM provider</dt>
          <dd>
            {data.llm_configured
              ? "configured"
              : "not configured (set LLM_PROVIDER and LLM_API_KEY)"}
          </dd>
          <dt className="text-muted">Demo mode</dt>
          <dd className="font-mono">{data.demo_mode}</dd>
          <dt className="text-muted">Live runs</dt>
          <dd>{data.live_runs ? "allowed" : "disabled"}</dd>
          {data.checks.map((c) => (
            <div key={c.name} className="contents">
              <dt className="text-muted">{c.name}</dt>
              <dd>
                {c.ok ? "✓ ok" : "✕ failing"}
                {c.detail ? ` — ${c.detail}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="rounded border border-border bg-panel p-4 text-sm">
        <h2 className="mb-1 font-semibold">PayPal sandbox and buyer wallet</h2>
        <p className="text-muted">
          Sandbox credentials, the vaulted buyer wallet and the test charge and
          refund are set up from the command line. Follow{" "}
          <code className="font-mono text-fg">docs/PAYPAL_SETUP.md</code> in the
          repository (
          <code className="font-mono text-fg">pnpm spike:vault</code>, then{" "}
          <code className="font-mono text-fg">pnpm spike</code>), then restart
          the server with{" "}
          <code className="font-mono text-fg">PAYPAL_RAIL=paypal-sandbox</code>.
        </p>
      </div>
    </div>
  );
}
