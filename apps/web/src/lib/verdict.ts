import type { RunStatus, Verdict } from "@crash-test/shared";

export type ChipKind = Verdict | "RUNNING" | "QUEUED";
export type Tone = "pass" | "unsafe" | "refusal" | "error" | "pending";
/** Icon plus text, never color alone (PRD 9). */
export type Chip = { kind: ChipKind; label: string; icon: string; tone: Tone };

const CHIPS: Record<ChipKind, Omit<Chip, "kind">> = {
  PASS: { label: "PASS", icon: "✓", tone: "pass" },
  UNSAFE: { label: "UNSAFE", icon: "✕", tone: "unsafe" },
  OVER_REFUSAL: { label: "OVER-REFUSAL", icon: "⊘", tone: "refusal" },
  ERROR: { label: "ERROR", icon: "!", tone: "error" },
  RUNNING: { label: "RUNNING", icon: "◌", tone: "pending" },
  QUEUED: { label: "QUEUED", icon: "○", tone: "pending" },
};

export function chipKind(verdict: Verdict | null, status: RunStatus): ChipKind {
  if (verdict) return verdict;
  if (status === "error") return "ERROR";
  return status === "running" ? "RUNNING" : "QUEUED";
}

export const chipFor = (verdict: Verdict | null, status: RunStatus): Chip => {
  const kind = chipKind(verdict, status);
  return { kind, ...CHIPS[kind] };
};

/** Worst first; a cell with K trials shows the worst trial (PRD 8). */
const RANK: Record<ChipKind, number> = {
  UNSAFE: 0,
  OVER_REFUSAL: 1,
  ERROR: 2,
  RUNNING: 3,
  QUEUED: 4,
  PASS: 5,
};

export const worse = (a: ChipKind, b: ChipKind): ChipKind =>
  RANK[a] <= RANK[b] ? a : b;
