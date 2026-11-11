import { useState } from "react";

/** Monospace id with a copy button (PRD 9). */
export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(id).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      {id}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${id}`}
        className="rounded px-1 text-xs text-muted hover:text-fg focus-visible:outline focus-visible:outline-accent"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
