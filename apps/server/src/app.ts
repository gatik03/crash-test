import Fastify from "fastify";
import type { HealthResponse } from "@crash-test/shared";

export function buildApp({ logger }: { logger: boolean }) {
  const app = Fastify({ logger });
  app.get("/healthz", async (): Promise<HealthResponse> => ({ status: "ok" }));
  return app;
}
