import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Subscribes to the run's SSE stream while it is active and refetches the run
 * (and open scenario details) as scenario runs start and finish. The grid then
 * diffs rows by id and flashes changed cells.
 */
export function useRunStream(runId: string, active: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!active) return;
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["run", runId] });
      void qc.invalidateQueries({ queryKey: ["scenario-run"] });
    };
    es.addEventListener("scenario.started", refresh);
    es.addEventListener("scenario.finished", refresh);
    const stop = () => {
      es.close();
      refresh();
      void qc.invalidateQueries({ queryKey: ["runs"] });
    };
    es.addEventListener("run.finished", stop);
    // The server closes replayed streams; don't let EventSource reconnect in a loop. useRun polls as a fallback.
    es.onerror = stop;
    return () => es.close();
  }, [runId, active, qc]);
}
