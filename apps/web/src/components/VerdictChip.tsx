import type { Chip, Tone } from "../lib/verdict";

const TONE: Record<Tone, string> = {
  pass: "text-pass border-pass/50 bg-pass/10",
  unsafe: "text-unsafe border-unsafe/50 bg-unsafe/10",
  refusal: "text-refusal border-refusal/50 bg-refusal/10",
  error: "text-error border-error/50 bg-error/10",
  pending: "text-muted border-border",
};

export function VerdictChip({ chip, extra }: { chip: Chip; extra?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs font-semibold ${TONE[chip.tone]}`}
    >
      <span aria-hidden="true">{chip.icon}</span>
      {chip.label}
      {extra ? <span className="font-normal opacity-80">{extra}</span> : null}
    </span>
  );
}
