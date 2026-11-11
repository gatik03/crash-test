import Fastify from "fastify";
import type { HealthResponse } from "@crash-test/shared";
import { shopRoutes } from "./shop/routes.js";
import { ShopSessions } from "./shop/session.js";

export function buildApp({
  logger,
  shopSessions = new ShopSessions(),
}: {
  logger: boolean;
  shopSessions?: ShopSessions;
}) {
  const app = Fastify({ logger });
  app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));
  app.register(shopRoutes, { prefix: "/shop/v1", sessions: shopSessions });
  return app;
}
