import type { Explanation, LedgerSnapshot } from "@crash-test/shared";
import { describe, expect, it } from "vitest";
import type { LLMClient } from "../agents/llm/LLMClient.js";
import { RunEventHub } from "../api/sse.js";
import { buildApp, SUITES_DIR } from "../app.js";
import { openDb } from "../db/db.js";
import { listEvents } from "../db/repo.js";
import { getRun, listScenarioRuns } from "../db/runsRepo.js";
import { MockRail } from "../rails/MockRail.js";
import type { Rail } from "../rails/Rail.js";
import { loadSuite } from "../scenarios/loader.js";
import { ShopSessions } from "../shop/session.js";
import { cleanupRefunds, Orchestrator } from "./orchestrator.js";
import type { ReadableSink } from "./scenarioRun.js";

const usd = (minor: number) => ({ minor, currency: "USD" as const });

/** Orchestrator on MockRail; `patch` swaps rail methods to inject failures. */
async function orchestrator(
  patch: (r: MockRail) => void,
  judge?: { llm: LLMClient; model: string },
  judgeTimeoutMs?: number,
) {
  const db = openDb(":memory:");
  const shopSessions = new ShopSessions();
  const app = buildApp({ logger: false, shopSessions });
  const hub = new RunEventHub();
  const o = new Orchestrator({
    db,
    app: { inject: (x) => app.inject(x) },
    shopSessions,
    hub,
    suites: { "core-v1": await loadSuite(`${SUITES_DIR}/core-v1`) },
    makeRail: (sink) => {
      const r = new MockRail(sink);
      patch(r);
      return r;
    },
    concurrency: 1,
    cleanupRefundsDefault: true,
    ...(judge && { judge }),
    ...(judgeTimeoutMs && { judgeTimeoutMs }),
  });
  return { o, db, hub };
}

describe("cleanupRefunds", () => {
  it("goes on past a failed capture, treats PENDING as covered and as success", async () => {
    const calls: string[] = [];
    const rail = {
      refund: async (req: { captureId: string }) => {
        calls.push(req.captureId);
        if (req.captureId === "C1") throw new Error("boom");
        return { refundId: "R2", status: "PENDING", amount: usd(500) };
      },
    } as unknown as Rail;
    const events: unknown[] = [];
    const sink = {
      append: (e: unknown) => (events.push(e), e),
      for: () => [],
    } as unknown as ReadableSink;
    const cap = (id: string, refunds: { status: string; minor: number }[]) => ({
      id,
      status: "COMPLETED",
      amount: usd(500),
      refunds: refunds.map((r, i) => ({
        id: `${id}-r${i}`,
        status: r.status,
        amount: usd(r.minor),
      })),
    });
    const snapshot: LedgerSnapshot = {
      orders: [
        {
          id: "O1",
          status: "COMPLETED",
          items: [],
          captures: [
            cap("C1", []),
            cap("C2", []),
            cap("C3", [{ status: "PENDING", minor: 500 }]),
          ],
        },
      ],
      net_captured: usd(1500),
      capture_count: 3,
    };
    const errors = await cleanupRefunds(rail, sink, "sr", snapshot);
    expect(calls).toEqual(["C1", "C2"]);
    expect(errors).toEqual(["C1: boom"]);
    expect(events.map((e) => (e as { type: string }).type)).toEqual([
      "cleanup.error",
      "cleanup.refund",
    ]);
  });
});

describe("Orchestrator", () => {
  it("still refunds from the WAL when the audit throws after a charge", async () => {
    const { o, db } = await orchestrator((r) => {
      const get = r.getOrder.bind(r);
      let failed = false;
      r.getOrder = (id) => {
        if (failed) return get(id);
        failed = true;
        return Promise.reject(new Error("rail down"));
      };
    });
    const runId = o.createRun({
      profile_ids: ["oracle"],
      scenario_ids: ["S01"],
    });
    await o.wait(runId);
    const [sr] = listScenarioRuns(db, runId);
    expect(sr).toMatchObject({ verdict: "ERROR", error: "rail down" });
    const refunds = listEvents(db, sr!.id).filter(
      (e) => e.type === "cleanup.refund",
    );
    expect(refunds).toHaveLength(1);
    const orderId = listEvents(db, sr!.id).flatMap((e) =>
      e.type === "rail.charge.result" ? [e.payload.result.orderId] : [],
    )[0];
    expect((await o.rail.getOrder(orderId!)).captures[0]?.status).toBe(
      "REFUNDED",
    );
  });

  it("collects per-capture cleanup errors and keeps the verdict", async () => {
    const { o, db } = await orchestrator((r) => {
      const refund = r.refund.bind(r);
      let n = 0;
      r.refund = (req) =>
        n++ === 0 ? Promise.reject(new Error("refund down")) : refund(req);
    });
    const runId = o.createRun({
      profile_ids: ["saboteur"],
      scenario_ids: ["S01"],
    });
    await o.wait(runId);
    const [sr] = listScenarioRuns(db, runId);
    expect(sr?.verdict).toBe("UNSAFE");
    expect(sr?.status).toBe("error");
    expect(sr?.error).toMatch(/cleanup refund failed: .*refund down/);
    expect(getRun(db, runId)?.status).toBe("error");
    const types = listEvents(db, sr!.id).map((e) => e.type);
    expect(types.filter((t) => t === "cleanup.refund")).toHaveLength(1);
    expect(types).toContain("cleanup.error");
  });

  it("judges UNSAFE runs after the verdict, emits judge.ready; a failing judge changes nothing", async () => {
    const valid: Explanation = {
      root_cause: "no_idempotency",
      offending_step: null,
      explanation: "Confirmed twice without a key.",
      evidence: [],
      confidence: "high",
    };
    let fail = false;
    const llm: LLMClient = {
      async chat(req) {
        if (fail) throw new Error("judge down");
        const seq = /\[seq (\d+)\]/.exec(String(req.messages[1]?.content));
        const content = JSON.stringify({
          ...valid,
          evidence: [Number(seq?.[1])],
        });
        return {
          message: { role: "assistant", content },
          toolCalls: [],
          usage: { in: 1, out: 1 },
        };
      },
    };
    const { o, db, hub } = await orchestrator(() => {}, { llm, model: "j" });
    const runId = o.createRun({
      profile_ids: ["saboteur", "oracle"],
      scenario_ids: ["S01"],
    });
    const seen: string[] = [];
    hub.subscribe(runId, 0, (e) => seen.push(e.type));
    await o.wait(runId);
    const by = (p: string) =>
      listScenarioRuns(db, runId).find((r) => r.profile_id === p)!;
    expect(o.explanation(by("saboteur").id)).toMatchObject({
      status: "ready",
      explanation: { root_cause: "no_idempotency" },
    });
    expect(o.explanation(by("oracle").id)).toEqual({
      status: "none",
      explanation: null,
    });
    expect(seen.indexOf("judge.ready")).toBeGreaterThan(
      seen.indexOf("scenario.finished"),
    );
    expect(seen.at(-1)).toBe("run.finished");

    fail = true;
    const second = o.createRun({
      profile_ids: ["saboteur"],
      scenario_ids: ["S01"],
    });
    await o.wait(second);
    const [sr] = listScenarioRuns(db, second);
    expect(sr).toMatchObject({ verdict: "UNSAFE", status: "done" });
    expect(o.explanation(sr!.id).status).toBe("failed");
  });

  it("a hung judge times out, is stored as failed, and the run still finishes with its verdict", async () => {
    const llm: LLMClient = { chat: () => new Promise(() => {}) };
    const { o, db } = await orchestrator(() => {}, { llm, model: "j" }, 20);
    const runId = o.createRun({
      profile_ids: ["saboteur"],
      scenario_ids: ["S01"],
    });
    await o.wait(runId);
    const [sr] = listScenarioRuns(db, runId);
    expect(sr).toMatchObject({ verdict: "UNSAFE", status: "done" });
    expect(getRun(db, runId)?.status).toBe("done");
    expect(o.explanation(sr!.id).status).toBe("failed");
  });

  it("WAL fallback still refunds other orders when one getOrder fails", async () => {
    const { o, db } = await orchestrator((r) => {
      const get = r.getOrder.bind(r);
      let first: string | undefined;
      r.getOrder = (id) => {
        first ??= id;
        return id === first ? Promise.reject(new Error("order down")) : get(id);
      };
    });
    const runId = o.createRun({
      profile_ids: ["saboteur"],
      scenario_ids: ["S06"],
    });
    await o.wait(runId);
    const [sr] = listScenarioRuns(db, runId);
    const events = listEvents(db, sr!.id);
    const orders = new Set(
      events.flatMap((e) =>
        e.type === "rail.charge.result" ? [e.payload.result.orderId] : [],
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
    expect(sr?.error).toMatch(/order down/);
    expect(events.filter((e) => e.type === "cleanup.refund").length).toBe(
      orders.size - 1,
    );
  });
});
