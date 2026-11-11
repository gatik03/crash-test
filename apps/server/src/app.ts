import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { HealthResponse, Scenario } from "@crash-test/shared";
import { apiRoutes, type ApiDeps } from "./api/routes.js";
import { LiveGate } from "./api/liveGate.js";
import { loadFixtures } from "./api/replay.js";
import { RunEventHub } from "./api/sse.js";
import { registerLlmProfiles } from "./agents/registerProfiles.js";
import type { LLMClient } from "./agents/llm/LLMClient.js";
import type { Config } from "./config.js";
import { openDb, type Db } from "./db/db.js";
import { recoverStuckRuns } from "./db/runsRepo.js";
import { Orchestrator, railFromConfig } from "./engine/orchestrator.js";
import { loadSuite } from "./scenarios/loader.js";
import { shopRoutes } from "./shop/routes.js";
import { ShopSessions } from "./shop/session.js";

// src/ and dist/ sit at the same depth, so these resolve in dev and in the build.
const repoPath = (p: string) =>
  fileURLToPath(new URL(`../../../${p}`, import.meta.url));
export const SUITES_DIR = repoPath("scenarios");
export const FIXTURES_DIR = repoPath("fixtures/gold-runs");
const WEB_DIST = repoPath("apps/web/dist");

export function buildApp({
  logger,
  shopSessions = new ShopSessions(),
  api,
  behindProxy = false,
}: {
  logger: boolean;
  shopSessions?: ShopSessions;
  api?: ApiDeps;
  /** Trust exactly one proxy hop (Render) for `req.ip`; more would let clients spoof it. */
  behindProxy?: boolean;
}) {
  const app = Fastify({
    logger,
    bodyLimit: 100 * 1024,
    trustProxy: behindProxy && ((_addr: string, hop: number) => hop < 1),
  });
  app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));
  app.register(shopRoutes, { prefix: "/shop/v1", sessions: shopSessions });
  if (api) app.register(apiRoutes, { prefix: "/api", ...api });
  return app;
}

export type Server = {
  app: ReturnType<typeof buildApp>;
  orchestrator: Orchestrator;
  db: Db;
};

/**
 * The whole server: DB, suites, orchestrator, API, and the built web app when present.
 * `boot` runs crash recovery and loads fixtures; the CLI skips it so a running server keeps its rows.
 */
export async function createServer({
  config,
  logger,
  db = openDb(config.DATABASE_PATH),
  boot = true,
  llm,
}: {
  config: Config;
  logger: boolean;
  db?: Db;
  boot?: boolean;
  /** Replaces the configured LLM client (tests). */
  llm?: LLMClient;
}): Promise<Server> {
  const client = registerLlmProfiles(config, llm);
  const judgeModel = config.LLM_MODEL_JUDGE;
  if (boot) {
    recoverStuckRuns(db);
    loadFixtures(db, FIXTURES_DIR);
  }
  const suites: Record<string, Scenario[]> = {
    "core-v1": await loadSuite(`${SUITES_DIR}/core-v1`),
  };
  const shopSessions = new ShopSessions();
  const hub = new RunEventHub();
  // The orchestrator drives the Shop through app.inject; no run starts before `app` exists.
  const orchestrator = new Orchestrator({
    db,
    app: { inject: (o) => app.inject(o) },
    shopSessions,
    hub,
    suites,
    makeRail: (sink) => railFromConfig(config, sink),
    concurrency: config.RUN_CONCURRENCY,
    cleanupRefundsDefault: config.CLEANUP_REFUNDS_DEFAULT,
    ...(client && judgeModel && { judge: { llm: client, model: judgeModel } }),
  });
  const app = buildApp({
    logger,
    shopSessions,
    behindProxy: config.DEMO_MODE === "public",
    api: {
      db,
      config,
      orchestrator,
      suites,
      hub,
      liveGate: new LiveGate(db, {
        perIp: config.LIVE_RUNS_PER_IP_PER_DAY,
        global: config.LIVE_RUNS_GLOBAL_PER_DAY,
      }),
    },
  });
  if (existsSync(WEB_DIST)) {
    app.register(fastifyStatic, { root: WEB_DIST });
    // SPA fallback: client routes get index.html; API and Shop paths keep JSON 404s.
    app.setNotFoundHandler((req, reply) =>
      /^\/(api|shop)(\/|$)/.test(req.url) || req.method !== "GET"
        ? reply
            .code(404)
            .send({ error: { code: "not_found", message: "no such endpoint" } })
        : reply.sendFile("index.html"),
    );
  }
  return { app, orchestrator, db };
}
