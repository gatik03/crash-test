import { timingSafeEqual } from "node:crypto";
import type {
  ApiHealthResponse,
  CreateRunResponse,
  ProfileListResponse,
  RunDetail,
  RunListResponse,
  Scenario,
  ScenarioRunDetail,
  SuiteSummary,
} from "@crash-test/shared";
import { CreateRunRequest } from "@crash-test/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import { listEvents, listLedgerEntries } from "../db/repo.js";
import {
  getExplanation,
  getRun,
  getScenarioRun,
  listAssertionResults,
  listRuns,
  listScenarioRuns,
} from "../db/runsRepo.js";
import {
  Orchestrator,
  OrchestratorError,
  scoreRun,
  SUITE_VERSION,
} from "../engine/orchestrator.js";
import { listProfiles } from "../engine/profiles.js";
import type { LiveGate } from "./liveGate.js";
import { sseRoutes, type RunEventHub } from "./sse.js";

export type ApiDeps = {
  db: Db;
  config: Config;
  orchestrator: Orchestrator;
  suites: Readonly<Record<string, readonly Scenario[]>>;
  hub: RunEventHub;
  liveGate: LiveGate;
};

const fail = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) => reply.code(status).send({ error: { code, message } });

/** True when the request carries `Authorization: Bearer <ADMIN_TOKEN>`. */
function isAdmin(config: Config, req: FastifyRequest): boolean {
  const token = config.ADMIN_TOKEN;
  const header = req.headers.authorization;
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ARCHITECTURE 11, mounted under `/api`. */
export async function apiRoutes(app: FastifyInstance, deps: ApiDeps) {
  const { db, config, orchestrator, suites, hub, liveGate } = deps;

  app.setErrorHandler(
    (
      err: { statusCode?: number; code?: string; message: string },
      _req,
      reply,
    ) => {
      const status =
        err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
      return fail(
        reply,
        status,
        status === 500 ? "internal" : (err.code ?? "bad_request"),
        status === 500 ? "internal error" : err.message,
      );
    },
  );
  app.setNotFoundHandler((_req, reply) =>
    fail(reply, 404, "not_found", "no such endpoint"),
  );

  app.get("/health", async (): Promise<ApiHealthResponse> => {
    const health = await orchestrator.rail.preflight();
    return {
      status: health.ok ? "ok" : "degraded",
      rail: orchestrator.rail.kind,
      demo_mode: config.DEMO_MODE,
      live_runs: config.ALLOW_LIVE_RUNS,
      llm_configured: Boolean(config.LLM_PROVIDER && config.LLM_API_KEY),
      checks: health.checks,
    };
  });

  const summary = (
    id: string,
    scenarios: readonly Scenario[],
  ): SuiteSummary => ({
    id,
    version: SUITE_VERSION,
    scenarios: scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      category: s.category,
      severity: s.severity,
      feasible: s.feasible,
    })),
  });
  app.get("/suites", async () => ({
    suites: Object.entries(suites).map(([id, s]) => summary(id, s)),
  }));
  app.get<{ Params: { id: string } }>("/suites/:id", async (req, reply) => {
    const s = suites[req.params.id];
    return s
      ? summary(req.params.id, s)
      : fail(reply, 404, "not_found", "suite not found");
  });

  app.get("/profiles", async (): Promise<ProfileListResponse> => ({
    profiles: listProfiles().map((id) => ({ id, kind: "builtin" as const })),
  }));

  app.post("/runs", async (req, reply) => {
    const parsed = CreateRunRequest.safeParse(req.body);
    if (!parsed.success)
      return fail(reply, 400, "invalid_request", parsed.error.message);
    const admin = isAdmin(config, req);
    if (!config.ALLOW_LIVE_RUNS && !admin)
      return fail(reply, 403, "live_disabled", "live runs are disabled");
    if (config.DEMO_MODE === "public" && parsed.data.trials > 1 && !admin)
      return fail(
        reply,
        403,
        "admin_required",
        "trials > 1 need the admin token",
      );
    if (!admin && !liveGate.take(req.ip))
      return reply.code(429).send({
        reason: "cap",
        error: {
          code: "cap",
          message: "daily live-run cap reached; open a recorded run",
        },
      });
    try {
      const body: CreateRunResponse = {
        run_id: orchestrator.createRun(parsed.data),
      };
      return reply.code(202).send(body);
    } catch (e) {
      if (e instanceof OrchestratorError)
        return fail(reply, 400, e.code, e.message);
      throw e;
    }
  });

  app.get("/runs", async (): Promise<RunListResponse> => ({
    runs: listRuns(db),
  }));

  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const run = getRun(db, req.params.id);
    if (!run) return fail(reply, 404, "not_found", "run not found");
    const scenario_runs = listScenarioRuns(db, run.id);
    const body: RunDetail = {
      run,
      scenario_runs,
      scores: scoreRun(scenario_runs, suites[run.suite_id] ?? []),
    };
    return body;
  });

  sseRoutes(app, { db, hub });

  app.get<{ Params: { id: string } }>(
    "/scenario-runs/:id",
    async (req, reply) => {
      const sr = getScenarioRun(db, req.params.id);
      if (!sr) return fail(reply, 404, "not_found", "scenario run not found");
      const body: ScenarioRunDetail = {
        scenario_run: sr,
        events: listEvents(db, sr.id),
        ledger: listLedgerEntries(db, sr.id),
        assertions: listAssertionResults(db, sr.id),
        explanation: getExplanation(db, sr.id),
      };
      return body;
    },
  );
}
