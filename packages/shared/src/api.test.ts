import { describe, expect, it } from "vitest";
import { HealthResponse } from "./api.js";

describe("HealthResponse", () => {
  it("accepts a healthy response", () => {
    expect(HealthResponse.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it("rejects any other status", () => {
    expect(HealthResponse.safeParse({ status: "down" }).success).toBe(false);
  });
});
