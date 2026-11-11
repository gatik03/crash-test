import { useEffect, useRef, useState } from "react";
import { useScenarioRun } from "../api/queries";
import { chipFor } from "../lib/verdict";
import { AssertionList } from "./AssertionList";
import { CopyId } from "./CopyId";
import { ExplanationCard } from "./ExplanationCard";
import { MoneyPanel } from "./MoneyPanel";
import { TranscriptView } from "./TranscriptView";
import { VerdictChip } from "./VerdictChip";

const TABS = ["Transcript", "Money", "Assertions", "Explanation"] as const;
type Tab = (typeof TABS)[number];

export function ScenarioDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Money");
  const heading = useRef<HTMLHeadingElement>(null);
  const { data, error, isPending } = useScenarioRun(id);

  useEffect(() => heading.current?.focus(), [id]);

  const sr = data?.scenario_run;
  return (
    <section
      aria-labelledby="detail-heading"
      className="rounded border border-border bg-panel p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2
          id="detail-heading"
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {sr
            ? `${sr.scenario_id} · ${sr.profile_id} · trial ${sr.trial}`
            : "Scenario run"}
        </h2>
        {sr && <VerdictChip chip={chipFor(sr.verdict, sr.status)} />}
        {sr && (
          <span className="text-xs text-muted">
            <CopyId id={sr.id} />
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-border px-2 py-1 text-sm hover:bg-raised"
        >
          Close
        </button>
      </div>
      {sr?.error && (
        <p className="mb-2 font-mono text-sm text-error">! {sr.error}</p>
      )}

      <div
        role="tablist"
        aria-label="Scenario detail"
        className="mb-3 flex gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="detail-panel"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === t
                ? "border-accent text-fg"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="detail-panel" aria-labelledby={`tab-${tab}`}>
        {isPending && <p className="text-sm text-muted">Loading…</p>}
        {error && <p className="text-sm text-unsafe">✕ {error.message}</p>}
        {data && tab === "Transcript" && (
          <TranscriptView events={data.events} />
        )}
        {data && tab === "Money" && (
          <MoneyPanel ledger={data.ledger} assertions={data.assertions} />
        )}
        {data && tab === "Assertions" && (
          <AssertionList assertions={data.assertions} />
        )}
        {data && tab === "Explanation" && <ExplanationCard id={id} />}
      </div>
    </section>
  );
}
