import type { LedgerEntryDto } from "@crash-test/shared";
import type { ColDef } from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { CopyId } from "../components/CopyId";
import { formatMinor } from "../lib/money";
import { gridTheme } from "../theme/grid";

const idCell = (p: CustomCellRendererProps<LedgerEntryDto, string | null>) =>
  p.value ? <CopyId id={p.value} /> : <span className="text-muted">—</span>;

const columns: ColDef<LedgerEntryDto>[] = [
  { field: "kind", width: 100 },
  {
    field: "paypal_id",
    headerName: "PayPal id",
    flex: 1,
    minWidth: 220,
    cellRenderer: idCell,
  },
  {
    field: "parent_paypal_id",
    headerName: "Parent",
    flex: 1,
    minWidth: 220,
    cellRenderer: idCell,
  },
  {
    field: "amount_minor",
    headerName: "Amount",
    width: 120,
    type: "rightAligned",
    valueFormatter: (p) =>
      p.value == null ? "—" : formatMinor(p.value, p.data?.currency ?? null),
  },
  { field: "status", width: 170 },
];

/** PayPal order / capture / refund objects for one scenario run (Money tab). */
export function MoneyGrid({ ledger }: { ledger: LedgerEntryDto[] }) {
  return (
    <div aria-label="PayPal ledger entries">
      <AgGridReact<LedgerEntryDto>
        theme={gridTheme}
        rowData={ledger}
        columnDefs={columns}
        domLayout="autoHeight"
        overlayNoRowsTemplate="No PayPal objects: the agent did not charge"
      />
    </div>
  );
}
