import type { AppEvent } from "@crash-test/shared";
import { formatValue } from "../lib/money";

/** Merchant/tool output is attacker-controlled: shown as plain text inside a visible fence (AGENTS rule 11). */
function Untrusted({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-1 rounded border border-dashed border-refusal/70 bg-refusal/5">
      <div className="px-2 py-0.5 font-mono text-xs text-refusal">
        ⚠ UNTRUSTED {label} — plain text
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-2 pb-2 text-xs">
        {formatValue(value)}
      </pre>
    </div>
  );
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
      {formatValue(value)}
    </pre>
  );
}

function Body({ e }: { e: AppEvent }) {
  if (e.type === "agent.step")
    return (
      <>
        <div className="text-xs text-muted">
          Agent called {String(e.payload.tool)} with
        </div>
        <Pre value={e.payload.args} />
        <Untrusted label="tool result" value={e.payload.result} />
      </>
    );
  if (e.type === "shop.call")
    return (
      <>
        <div className="text-xs text-muted">
          Shop {String(e.payload.op)} → HTTP {String(e.payload.status)}
        </div>
        <Pre value={e.payload.request} />
        <Untrusted label="merchant response" value={e.payload.response} />
      </>
    );
  return <Pre value={e.payload} />;
}

const SHOWN = new Set<AppEvent["type"]>(["agent.step", "shop.call"]);

export function TranscriptView({ events }: { events: AppEvent[] }) {
  const shown = events.filter((e) => SHOWN.has(e.type));
  if (shown.length === 0)
    return <p className="text-sm text-muted">No agent steps recorded.</p>;
  return (
    <ol className="space-y-3">
      {shown.map((e) => (
        <li key={e.seq} className="rounded border border-border bg-raised p-2">
          <div className="mb-1 flex gap-3 font-mono text-xs">
            <span className="text-muted">#{e.seq}</span>
            <span className="font-semibold">{e.type}</span>
            <time className="ml-auto text-muted">{e.ts}</time>
          </div>
          <Body e={e} />
        </li>
      ))}
    </ol>
  );
}
