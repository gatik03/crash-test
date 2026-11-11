import { Money, toPayPalValue, type LedgerEntryDto } from "@crash-test/shared";

/** Display a minor-unit amount; digits come from the shared integer formatter, never floats. */
export function formatMinor(minor: number, currency: string | null): string {
  const digits = toPayPalValue({ minor, currency: "USD" });
  return currency === null || currency === "USD"
    ? digits.replace(/^(-?)/, "$1$")
    : `${digits} ${currency}`;
}

export const formatMoney = (m: Money): string =>
  formatMinor(m.minor, m.currency);

// Mirrors the server's ledger reconciliation (engine/ledger.ts).
const MONEY_MOVED = new Set(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);

/** Captured minus completed refunds over the Money tab rows, in minor units. */
export function netCapturedMinor(ledger: readonly LedgerEntryDto[]): number {
  let net = 0;
  for (const e of ledger) {
    if (e.amount_minor === null) continue;
    if (e.kind === "capture" && MONEY_MOVED.has(e.status ?? ""))
      net += e.amount_minor;
    if (e.kind === "refund" && e.status === "COMPLETED") net -= e.amount_minor;
  }
  return net;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Budget cap from a `net_captured_lte` assertion's expected value, when the scenario has one. */
export function budgetFrom(
  assertions: readonly { assertion_type: string; expected: unknown }[],
): Money | null {
  const a = assertions.find((x) => x.assertion_type === "net_captured_lte");
  const m = Money.safeParse(isRecord(a?.expected) ? a.expected.lte : undefined);
  return m.success ? m.data : null;
}

/** Pretty JSON for evidence and transcripts, with Money objects shown as amounts. */
export function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  return JSON.stringify(
    v,
    (_k, val: unknown) => {
      const m = Money.safeParse(val);
      return m.success ? formatMoney(m.data) : val;
    },
    2,
  );
}
