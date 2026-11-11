import type { Db } from "../db/db.js";

/**
 * Daily live-run caps (ARCHITECTURE 5.8): per IP in memory, global persisted in `live_usage`.
 * Days are UTC.
 */
export class LiveGate {
  private day = "";
  private readonly perIp = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly limits: { perIp: number; global: number },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Counts one live run for `ip`; false when either cap is already reached. */
  take(ip: string): boolean {
    const day = this.now().toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.perIp.clear();
    }
    const mine = this.perIp.get(ip) ?? 0;
    return this.db.transaction(() => {
      const global =
        this.db
          .prepare<[string], { count: number }>(
            "SELECT count FROM live_usage WHERE day = ?",
          )
          .get(day)?.count ?? 0;
      if (mine >= this.limits.perIp || global >= this.limits.global)
        return false;
      this.db
        .prepare(
          "INSERT INTO live_usage (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1",
        )
        .run(day);
      this.perIp.set(ip, mine + 1);
      return true;
    })();
  }
}
