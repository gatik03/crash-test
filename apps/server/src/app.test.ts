import { describe, expect, it } from "vitest";
import { HealthResponse } from "@crash-test/shared";
import { buildApp } from "./app.js";

describe("GET /healthz", () => {
  it("returns a valid HealthResponse", async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: "ok" });
  });
});
