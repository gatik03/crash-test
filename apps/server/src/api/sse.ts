import type { FastifyInstance } from "fastify";
import type { Db } from "../db/db.js";
import { listEvents } from "../db/repo.js";
import { getRun, listScenarioRuns } from "../db/runsRepo.js";

export type HubEvent = { id: number; type: string; data: unknown };
type Listener = (e: HubEvent) => void;
type Channel = { events: HubEvent[]; listeners: Set<Listener> };

/** SSE event name for a stored event type: the rail's write-ahead kinds collapse into `rail.charge` (5.7). */
export const sseType = (type: string): string =>
  type.startsWith("rail.charge.") ? "rail.charge" : type;

/**
 * In-memory pub/sub per run with sequence ids for `Last-Event-ID` resume.
 * shortcut: buffers are kept for the process lifetime; prune finished runs if memory matters.
 */
export class RunEventHub {
  private readonly channels = new Map<string, Channel>();

  private channel(runId: string): Channel {
    let c = this.channels.get(runId);
    if (!c) {
      c = { events: [], listeners: new Set() };
      this.channels.set(runId, c);
    }
    return c;
  }

  has(runId: string): boolean {
    return this.channels.has(runId);
  }

  publish(runId: string, type: string, data: unknown): void {
    const c = this.channel(runId);
    const e = { id: c.events.length + 1, type: sseType(type), data };
    c.events.push(e);
    for (const l of c.listeners) l(e);
  }

  /** Replays buffered events after `afterId`, then streams live ones. Returns unsubscribe. */
  subscribe(runId: string, afterId: number, listener: Listener): () => void {
    const c = this.channel(runId);
    for (const e of c.events) if (e.id > afterId) listener(e);
    c.listeners.add(listener);
    return () => c.listeners.delete(listener);
  }
}

const frame = (e: HubEvent) =>
  `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`;

export function sseRoutes(
  app: FastifyInstance,
  { db, hub }: { db: Db; hub: RunEventHub },
): void {
  app.get<{ Params: { id: string } }>(
    "/runs/:id/events",
    async (req, reply) => {
      const run = getRun(db, req.params.id);
      if (!run)
        return reply.code(404).send({
          error: { code: "not_found", message: "run not found" },
        });
      const last = Number(req.headers["last-event-id"] ?? 0);
      const afterId = Number.isInteger(last) && last > 0 ? last : 0;

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      if (!hub.has(run.id)) {
        // Fixture or pre-restart run: rebuild the stream from the stored events.
        const done = run.status === "done" || run.status === "error";
        const out: HubEvent[] = [];
        for (const sr of listScenarioRuns(db, run.id))
          for (const e of listEvents(db, sr.id))
            out.push({ id: out.length + 1, type: sseType(e.type), data: e });
        if (done)
          out.push({
            id: out.length + 1,
            type: "run.finished",
            data: { run_id: run.id, status: run.status },
          });
        for (const e of out) if (e.id > afterId) res.write(frame(e));
        res.end();
        return;
      }

      let ended = false;
      const unsubscribe = hub.subscribe(run.id, afterId, (e) => {
        if (ended) return;
        res.write(frame(e));
        if (e.type === "run.finished") {
          ended = true;
          res.end();
        }
      });
      if (ended) unsubscribe();
      else req.raw.on("close", unsubscribe);
    },
  );
}
