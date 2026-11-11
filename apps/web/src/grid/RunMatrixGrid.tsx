import type { ProfileScoreDto } from "@crash-test/shared";
import type {
  CellClickedEvent,
  CellKeyDownEvent,
  ColDef,
  ColGroupDef,
} from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { VerdictChip } from "../components/VerdictChip";
import { gridTheme } from "../theme/grid";
import { cellText, passRate, type MatrixRow } from "./rows";

type Props = {
  rows: MatrixRow[];
  profiles: string[];
  scores: ProfileScoreDto[];
  onOpen: (scenarioRunId: string) => void;
};

const hasUnsafe = (r: MatrixRow | undefined) =>
  Object.values(r?.cells ?? {}).some((c) => c.chip.kind === "UNSAFE");

/** Results matrix: rows = scenarios, one column group per profile (FR-6.1). */
export function RunMatrixGrid({ rows, profiles, scores, onOpen }: Props) {
  const grid = useRef<AgGridReact<MatrixRow>>(null);
  const [quick, setQuick] = useState("");
  const [unsafeOnly, setUnsafeOnly] = useState(false);

  useEffect(() => grid.current?.api?.onFilterChanged(), [unsafeOnly]);

  const columnDefs = useMemo<(ColDef<MatrixRow> | ColGroupDef<MatrixRow>)[]>(
    () => [
      {
        headerName: "Scenario",
        pinned: "left",
        width: 300,
        valueGetter: (p) =>
          p.data ? `${p.data.scenario_id}  ${p.data.title}` : "",
        cellClass: "font-mono",
      },
      { headerName: "Severity", field: "severity", width: 110 },
      ...profiles.map((pid): ColGroupDef<MatrixRow> => {
        const s = scores.find((x) => x.profile_id === pid);
        return {
          headerName:
            s?.trust_score != null
              ? `${pid} · ${s.trust_score} (${s.grade ?? "—"})`
              : pid,
          children: [
            {
              colId: pid,
              headerName: "Verdict",
              minWidth: 180,
              flex: 1,
              enableCellChangeFlash: true,
              valueGetter: (p) => cellText(p.data?.cells[pid]),
              cellRenderer: (p: CustomCellRendererProps<MatrixRow>) => {
                const c = p.data?.cells[pid];
                return c ? (
                  <VerdictChip chip={c.chip} extra={passRate(c)} />
                ) : null;
              },
            },
          ],
        };
      }),
    ],
    [profiles, scores],
  );

  const open = (e: { data?: MatrixRow; column: { getColId(): string } }) => {
    const c = e.data?.cells[e.column.getColId()];
    if (c) onOpen(c.scenarioRunId);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Filter</span>
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="S06, UNSAFE…"
            className="rounded border border-border bg-raised px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={unsafeOnly}
            onChange={(e) => setUnsafeOnly(e.target.checked)}
          />
          UNSAFE only
        </label>
        <button
          type="button"
          onClick={() => grid.current?.api?.exportDataAsCsv()}
          className="ml-auto rounded border border-border px-2 py-1 hover:bg-raised"
        >
          Export CSV
        </button>
      </div>
      <div aria-label="Results matrix: scenarios by profile. Press Enter on a cell to open details.">
        <AgGridReact<MatrixRow>
          ref={grid}
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.scenario_id}
          domLayout="autoHeight"
          quickFilterText={quick}
          isExternalFilterPresent={() => unsafeOnly}
          doesExternalFilterPass={(n) => hasUnsafe(n.data)}
          rowClassRules={{
            "row-critical": (p) => p.data?.severity === "critical",
            "row-major": (p) => p.data?.severity === "major",
          }}
          onCellClicked={(e: CellClickedEvent<MatrixRow>) => open(e)}
          onCellKeyDown={(e: CellKeyDownEvent<MatrixRow>) => {
            if (e.event instanceof KeyboardEvent && e.event.key === "Enter")
              open(e);
          }}
          overlayNoRowsTemplate="No scenario runs yet"
        />
      </div>
    </div>
  );
}
