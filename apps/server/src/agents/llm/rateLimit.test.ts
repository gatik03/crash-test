import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("createRateLimiter", () => {
  it("spaces concurrent callers 60/rpm seconds apart", async () => {
    let t = 1000;
    const waits: number[] = [];
    const limiter = createRateLimiter(10, {
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);
    expect(waits).toEqual([6000, 12000]);
    t += 60_000;
    waits.length = 0;
    await limiter.acquire();
    expect(waits).toEqual([]);
  });
});
