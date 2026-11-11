import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiError,
  CreateRunResponse,
  ExplanationResponse,
  RunDetail,
  ScenarioRunDetail,
} from "@crash-test/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../app.js";
import { loadConfig } from "../config.js";
import { openDb } from "../db/db.js";
import { getRun, insertRun, insertScenarioRun } from "../db/runsRepo.js";
import { limiter } from "../engine/orchestrator.js";
import { registerProfile } from "../engine/profiles.js";
import { saveExplanation } from "../judge/explain.js";
import { recordGold } from "../recordGold.js";
import { LiveGate } from "./liveGate.js";
import { exportRun, loadFixtures, maskEmails, writeFixture } from "./replay.js";

let open: Server[] = [];
afterEach(async () => {
  for (const s of open) await s.app.close();
  open = [];
});

async function server(
  env: Record<string, string> = {},
  db = openDb(":memory:"),
) {
  const s = await createServer({ config: loadConfig(env), logger: false, db });
  open.push(s);
  return s;
}

async function startRun(s: Server, body: Record<string, unknown>) {
  const res = await s.app.inject({
    method: "POST",
    url: "/api/runs",
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(202);
  return CreateRunResponse.parse(res.json()).run_id;
}

async function pollDone(s: Server, runId: string): Promise<RunDetail> {
  for (let i = 0; i < 400; i++) {
    const res = await s.app.inject({
      method: "GET",
      url: `/api/runs/${runId}`,
    });
    const detail = RunDetail.parse(res.json());
    if (detail.run.status === "done" || detail.run.status === "error")
      return detail;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("run did not finish");
}

type Frame = { id: number; event: string; data: Record<string, unknown> };
const frames = (body: string): Frame[] =>
  body
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const f = Object.fromEntries(
        chunk
          .split("\n")
          .map((l) => [
            l.slice(0, l.indexOf(":")),
            l.slice(l.indexOf(":") + 2),
          ]),
      ) as Record<string, string>;
      return {
        id: Number(f.id),
        event: f.event ?? "",
        data: JSON.parse(f.data ?? "null") as Record<string, unknown>,
      };
    });

describe("runs API (MockRail, oracle profile)", () => {
  it("runs the full suite: all 10 PASS, grade A, nothing left captured", async () => {
    const s = await server();
    const runId = await startRun(s, { profile_ids: ["oracle"] });
    const detail = await pollDone(s, runId);
    expect(detail.run.status).toBe("done");
    expect(detail.scenario_runs).toHaveLength(10);
    expect(
      detail.scenario_runs.map((r) => [r.scenario_id, r.verdict, r.status]),
    ).toEqual(detail.scenario_runs.map((r) => [r.scenario_id, "PASS", "done"]));
    expect(detail.scores).toEqual([
      expect.objectContaining({
        profile_id: "oracle",
        trust_score: 100,
        grade: "A",
      }),
    ]);

    const s01 = detail.scenario_runs.find((r) => r.scenario_id === "S01");
    const res = await s.app.inject({
      method: "GET",
      url: `/api/scenario-runs/${s01?.id}`,
    });
    const sr = ScenarioRunDetail.parse(res.json());
    expect(sr.ledger.some((e) => e.kind === "capture")).toBe(true);
    expect(sr.assertions.length).toBeGreaterThan(0);
    expect(sr.assertions.every((a) => a.passed)).toBe(true);
    const cleanup = sr.events.filter((e) => e.type === "cleanup.refund");
    expect(cleanup).toHaveLength(1);
    // Cleanup happens after the snapshot and the assertions.
    const types = sr.events.map((e) => e.type);
    expect(types.indexOf("cleanup.refund")).toBeGreaterThan(
      types.lastIndexOf("assertion.result"),
    );
    const capture = sr.ledger.find((e) => e.kind === "capture");
    const order = await s.orchestrator.rail.getOrder(
      sr.ledger.find((e) => e.kind === "order")?.paypal_id ?? "",
    );
    expect(order.captures[0]?.status).toBe("REFUNDED");
    expect(capture?.status).toBe("COMPLETED"); // ledger rows are the pre-cleanup snapshot
  });

  it("streams SSE events in order and resumes after Last-Event-ID", async () => {
    const s = await server();
    const runId = await startRun(s, {
      profile_ids: ["oracle"],
      scenario_ids: ["S01", "S06"],
    });
    await pollDone(s, runId);
    const res = await s.app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    const all = frames(res.body);
    expect(all.map((f) => f.id)).toEqual(all.map((_, i) => i + 1));
    expect(all[0]?.event).toBe("run.started");
    expect(all.at(-1)?.event).toBe("run.finished");
    const seen = new Set(all.map((f) => f.event));
    for (const t of [
      "scenario.started",
      "agent.step",
      "shop.call",
      "rail.charge",
      "ledger.snapshot",
      "assertion.result",
      "scenario.finished",
    ])
      expect(seen, t).toContain(t);
    const order = [
      "scenario.started",
      "agent.step",
      "ledger.snapshot",
      "assertion.result",
      "scenario.finished",
    ];
    for (const srId of new Set(
      all.map((f) => f.data.scenarioRunId).filter(Boolean),
    )) {
      const mine = all
        .filter((f) => f.data.scenarioRunId === srId)
        .map((f) => f.event);
      const idx = order.map((t) => mine.indexOf(t));
      expect(idx.every((i) => i >= 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }

    const resumed = await s.app.inject({
      method: "GET",
      url: `/api/runs/${runId}/events`,
      headers: { "last-event-id": "5" },
    });
    expect(frames(resumed.body)[0]?.id).toBe(6);
  });

  it("thrown agent is ERROR; a runaway agent is scored", async () => {
    registerProfile("test-throws", () => ({
      run: () => Promise.reject(new Error("LLM unavailable")),
    }));
    registerProfile("test-runaway", () => ({
      run: async (t) => {
        await t.search_products("headphones");
        return {
          termination: "max_steps",
          steps: 25,
          tokensIn: 1,
          tokensOut: 2,
        };
      },
    }));
    const s = await server();
    const runId = await startRun(s, {
      profile_ids: ["test-throws", "test-runaway"],
      scenario_ids: ["S01"],
    });
    const { scenario_runs } = await pollDone(s, runId);
    const by = (p: string) => scenario_runs.find((r) => r.profile_id === p);
    expect(by("test-throws")).toMatchObject({
      verdict: "ERROR",
      status: "error",
      error: "LLM unavailable",
    });
    expect(by("test-runaway")).toMatchObject({
      verdict: "OVER_REFUSAL",
      status: "done",
      termination: "max_steps",
      steps: 25,
    });
  });

  it("rejects bad requests with the error shape", async () => {
    const s = await server();
    for (const payload of [{ profile_ids: [] }, { profile_ids: ["nope"] }]) {
      const res = await s.app.inject({
        method: "POST",
        url: "/api/runs",
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(ApiError.safeParse(res.json()).success).toBe(true);
    }
    const missing = await s.app.inject({
      method: "GET",
      url: "/api/runs/nope",
    });
    expect(missing.statusCode).toBe(404);
    expect(ApiError.parse(missing.json()).error.code).toBe("not_found");
  });

  it("lists suites and profiles", async () => {
    const s = await server();
    const suites = (
      await s.app.inject({ method: "GET", url: "/api/suites/core-v1" })
    ).json<{ scenarios: unknown[] }>();
    expect(suites.scenarios).toHaveLength(10);
    const profiles = (
      await s.app.inject({ method: "GET", url: "/api/profiles" })
    ).json<{ profiles: { id: string }[] }>();
    expect(profiles.profiles.map((p) => p.id)).toEqual(
      expect.arrayContaining(["oracle", "saboteur"]),
    );
    const health = await s.app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({ status: "ok", rail: "mock" });
  });

  it("caches the rail preflight for /api/health", async () => {
    const s = await server();
    let calls = 0;
    const preflight = s.orchestrator.rail.preflight.bind(s.orchestrator.rail);
    s.orchestrator.rail.preflight = () => (calls++, preflight());
    for (let i = 0; i < 3; i++)
      await s.app.inject({ method: "GET", url: "/api/health" });
    expect(calls).toBe(1);
  });

  it("dedupes ids, validates before the cap, limits the run list", async () => {
    const s = await server({ LIVE_RUNS_PER_IP_PER_DAY: "1" });
    for (const payload of [
      { profile_ids: ["oracle"], scenario_ids: ["S99"] },
      { profile_ids: ["oracle"], suite_id: "nope" },
    ]) {
      const bad = await s.app.inject({
        method: "POST",
        url: "/api/runs",
        payload,
      });
      expect(bad.statusCode).toBe(400);
    }
    const runId = await startRun(s, {
      profile_ids: ["oracle", "oracle"],
      scenario_ids: ["S01", "S01"],
    });
    const detail = await pollDone(s, runId);
    expect(detail.scenario_runs).toHaveLength(1);
    const runs = await s.app.inject({
      method: "GET",
      url: "/api/runs?limit=0",
    });
    expect(runs.json<{ runs: unknown[] }>().runs).toHaveLength(1);

    const sr = detail.scenario_runs[0];
    const ex = await s.app.inject({
      method: "GET",
      url: `/api/scenario-runs/${sr?.id}/explanation`,
    });
    expect(ExplanationResponse.parse(ex.json())).toEqual({
      status: "none",
      explanation: null,
    });
    const missing = await s.app.inject({
      method: "GET",
      url: "/api/scenario-runs/nope/explanation",
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("live gate", () => {
  it("returns 429 {reason:'cap'} over the per-IP cap, admin bypasses", async () => {
    const s = await server({
      LIVE_RUNS_PER_IP_PER_DAY: "1",
      ADMIN_TOKEN: "a".repeat(16),
    });
    await startRun(s, { profile_ids: ["oracle"], scenario_ids: ["S01"] });
    const res = await s.app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { profile_ids: ["oracle"] },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ reason: "cap", error: { code: "cap" } });
    const admin = await s.app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { authorization: `Bearer ${"a".repeat(16)}` },
      payload: { profile_ids: ["oracle"], scenario_ids: ["S01"] },
    });
    expect(admin.statusCode).toBe(202);
  });

  it("caps globally across IPs in live_usage and resets per IP each UTC day", () => {
    const db = openDb(":memory:");
    let now = new Date("2026-11-12T10:00:00Z");
    const gate = new LiveGate(db, { perIp: 1, global: 2 }, () => now);
    expect([
      gate.take("a"),
      gate.take("a"),
      gate.take("b"),
      gate.take("c"),
    ]).toEqual([true, false, true, false]);
    now = new Date("2026-11-13T00:00:01Z");
    expect(gate.take("a")).toBe(true);
    expect(
      db.prepare("SELECT day, count FROM live_usage ORDER BY day").all(),
    ).toEqual([
      { day: "2026-11-12", count: 2 },
      { day: "2026-11-13", count: 1 },
    ]);
  });
});

describe("crash recovery", () => {
  it("marks runs and scenario runs left running as error on boot", async () => {
    const db = openDb(":memory:");
    const t = new Date().toISOString();
    insertRun(db, {
      id: "run_stuck",
      suite_id: "core-v1",
      suite_version: "1",
      mode: "live",
      source: "live",
      trials: 1,
      status: "running",
      config: {},
      created_at: t,
      finished_at: null,
    });
    for (const [id, status] of [
      ["sr_a", "running"],
      ["sr_b", "queued"],
    ] as const)
      insertScenarioRun(db, {
        id,
        run_id: "run_stuck",
        scenario_id: "S01",
        profile_id: "oracle",
        trial: 1,
        status,
        verdict: null,
        safety_pass: null,
        task_pass: null,
        termination: null,
        steps: null,
        tokens_in: null,
        tokens_out: null,
        ledger_completeness: null,
        error: null,
        started_at: t,
        finished_at: null,
      });
    await server({}, db);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM scenario_runs WHERE status IN ('running','queued')",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(getRun(db, "run_stuck")?.status).toBe("error");
  });
});

describe("gold-run fixtures", () => {
  it("export → load round-trips as a recorded replay run", async () => {
    const s = await server();
    const runId = await startRun(s, {
      profile_ids: ["saboteur"],
      scenario_ids: ["S06"],
    });
    const { scenario_runs } = await pollDone(s, runId);
    const srId = scenario_runs[0]?.id ?? "";
    saveExplanation(
      s.db,
      srId,
      {
        root_cause: "no_idempotency",
        offending_step: null,
        explanation: "Retried confirm after the timeout without a key.",
        evidence: ["CAP-1"],
        confidence: "high",
      },
      "judge-model",
    );
    const dir = mkdtempSync(join(tmpdir(), "gold-"));
    expect(writeFixture(s.db, runId, dir, "naive-v1")).toBe(
      join(dir, "naive-v1.json"),
    );

    const db = openDb(":memory:");
    expect(loadFixtures(db, dir)).toBe(1);
    expect(loadFixtures(db, dir)).toBe(0); // idempotent
    const original = exportRun(s.db, runId);
    const loaded = exportRun(db, runId);
    expect(loaded.run).toMatchObject({ source: "fixture", mode: "replay" });
    expect({ ...loaded, run: original.run }).toEqual(original);
    expect(original.scenario_runs[0]?.verdict).toBe("UNSAFE");
    expect(original.explanations).toHaveLength(1);
    const replay = await server({}, db);
    const ex = await replay.app.inject({
      method: "GET",
      url: `/api/scenario-runs/${srId}/explanation`,
    });
    expect(ExplanationResponse.parse(ex.json())).toMatchObject({
      status: "ready",
      explanation: { root_cause: "no_idempotency", evidence: ["CAP-1"] },
    });
  });

  it("record-gold refuses the mock rail and writes nothing", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "gold-")), "out");
    expect(await recordGold(loadConfig({}), [], dir)).toBe(2);
    expect(existsSync(dir)).toBe(false);
  });

  it("masks payer emails", () => {
    expect(maskEmails('{"email":"buyer.one@personal.example.com"}')).toBe(
      '{"email":"b***@personal.example.com"}',
    );
  });
});

describe("limiter", () => {
  it("never runs more than n tasks at once", async () => {
    const run = limiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
