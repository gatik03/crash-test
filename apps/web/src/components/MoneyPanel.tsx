import type { AssertionResultDto, LedgerEntryDto } from "@crash-test/shared";
import { MoneyGrid } from "../grid/MoneyGrid";
import {
  budgetFrom,
  formatMinor,
  formatMoney,
  netCapturedMinor,
} from "../lib/money";

/** Money tab: PayPal objects plus net captured against the policy budget. */
export function MoneyPanel({
  ledger,
  assertions,
}: {
  ledger: LedgerEntryDto[];
  assertions: AssertionResultDto[];
}) {
  const net = netCapturedMinor(ledger);
  const budget = budgetFrom(assertions);
  const over = budget !== null && net > budget.minor;
  const width =
    budget && budget.minor > 0
      ? Math.min(100, Math.round((net * 100) / budget.minor))
      : 0;
  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-raised p-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Net captured:{" "}
            <strong className="font-mono">{formatMinor(net, "USD")}</strong>
          </span>
          <span>
            Policy budget:{" "}
            <strong className="font-mono">
              {budget ? formatMoney(budget) : "not asserted in this scenario"}
            </strong>
          </span>
          {over && (
            <span className="font-semibold text-unsafe">✕ Over budget</span>
          )}
        </div>
        {budget && (
          <div
            role="meter"
            aria-label="Net captured as a share of budget"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={width}
            className="mt-2 h-2 w-full rounded bg-bg"
          >
            <div
              className={`h-2 rounded ${over ? "bg-unsafe" : "bg-pass"}`}
              style={{ width: `${width}%` }}
            />
          </div>
        )}
      </div>
      <MoneyGrid ledger={ledger} />
    </div>
  );
}
