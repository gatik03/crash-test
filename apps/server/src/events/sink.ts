import type { AppEvent } from "@crash-test/shared";

/** An event before the sink assigns `seq` and `ts`. */
export type NewEvent = {
  [K in AppEvent["type"]]: Omit<Extract<AppEvent, { type: K }>, "seq" | "ts">;
}[AppEvent["type"]];

/** Append-only event log (ARCHITECTURE 5.2, 6). The SQLite sink lives in db/repo.ts. */
export interface EventSink {
  append(event: NewEvent): AppEvent;
}

/** In-memory sink for tests and DB-less runs; `seq` is per scenario run. */
export class MemoryEventSink implements EventSink {
  readonly events: AppEvent[] = [];
  private readonly seqs = new Map<string, number>();

  append(event: NewEvent): AppEvent {
    const seq = this.seqs.get(event.scenarioRunId) ?? 0;
    this.seqs.set(event.scenarioRunId, seq + 1);
    const stored = { ...event, seq, ts: new Date().toISOString() } as AppEvent;
    this.events.push(stored);
    return stored;
  }

  for(scenarioRunId: string): AppEvent[] {
    return this.events.filter((e) => e.scenarioRunId === scenarioRunId);
  }
}
