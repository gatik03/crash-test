export interface RateLimiter {
  /** Resolves when the caller may send one request. */
  acquire(): Promise<void>;
}

export interface LimiterDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Evenly spaces requests at `rpm` per minute. Slots are reserved synchronously,
 * so concurrent callers queue in order. shortcut: no burst allowance; add a
 * token bucket if bursts ever matter.
 */
export function createRateLimiter(
  rpm: number,
  { now = Date.now, sleep = realSleep }: LimiterDeps = {},
): RateLimiter {
  const interval = 60_000 / rpm;
  let next = 0;
  return {
    async acquire() {
      const t = now();
      const at = Math.max(t, next);
      next = at + interval;
      if (at > t) await sleep(at - t);
    },
  };
}
