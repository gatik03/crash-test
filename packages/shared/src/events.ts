import { z } from "zod";
import {
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  RefundResult,
} from "./ledger.js";

const envelope = {
  scenarioRunId: z.string(),
  seq: z.number().int().nonnegative(),
  /** ISO 8601 UTC. */
  ts: z.iso.datetime(),
};

const event = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ ...envelope, type: z.literal(type), payload });

// Payload shape is not fixed by the spec for these kinds yet.
const open = z.record(z.string(), z.unknown());

/** One model turn of an LLM agent: plain text and tool-call data only (provider extras such as thought signatures are dropped). */
export const AgentLlmPayload = z.object({
  content: z.string().nullable(),
  tool_calls: z.array(
    z.object({ id: z.string(), name: z.string(), arguments: z.string() }),
  ),
  usage: z.object({ in: z.number().int(), out: z.number().int() }),
});
export type AgentLlmPayload = z.infer<typeof AgentLlmPayload>;

/** Event kinds named in ARCHITECTURE 5.2 (write-ahead log), 5.7 (cleanup, SSE). */
export const AppEvent = z.discriminatedUnion("type", [
  event(
    "rail.charge.intent",
    z.object({ requestId: z.string(), request: ChargeRequest }),
  ),
  event(
    "rail.charge.result",
    z.object({ requestId: z.string(), result: ChargeResult }),
  ),
  event(
    "rail.charge.error",
    z.object({ requestId: z.string(), message: z.string() }),
  ),
  event(
    "cleanup.refund",
    z.object({ request: RefundRequest, result: RefundResult }),
  ),
  event(
    "cleanup.error",
    z.object({ captureId: z.string().optional(), message: z.string() }),
  ),
  event("run.started", open),
  event("scenario.started", open),
  event("agent.step", open),
  event("agent.llm", AgentLlmPayload),
  event("shop.call", open),
  event("rail.charge", open),
  event("ledger.snapshot", open),
  event("assertion.result", open),
  event("scenario.finished", open),
  event("judge.ready", open),
  event("run.finished", open),
]);
export type AppEvent = z.infer<typeof AppEvent>;
export type AppEventType = AppEvent["type"];
