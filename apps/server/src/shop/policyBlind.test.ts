import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryEventSink } from "../events/sink.js";
import { MockRail } from "../rails/MockRail.js";
import { ShopSessions } from "./session.js";

describe("shop is policy-blind (AGENTS rule 5)", () => {
  it("imports nothing from engine, scenarios, oracles, judge or assertion code", () => {
    const dir = new URL(".", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(new URL(f, dir), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map(
        (m) => m[1] ?? "",
      );
      for (const i of imports)
        expect(i, `${f} imports ${i}`).not.toMatch(
          /engine|scenario|oracle|judge|assertion/i,
        );
    }
  });

  it("session holds no policy or expected-outcome fields", () => {
    const sessions = new ShopSessions();
    const { token } = sessions.createShopSession({
      scenarioRunId: "sr",
      faults: [],
      slots: {},
      rail: new MockRail(),
      sink: new MemoryEventSink(),
    });
    const keys = Object.keys(sessions.get(token) ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys)
      expect(k).not.toMatch(
        /policy|expect|assert|feasible|scenarioId|instruction|budget/i,
      );
  });
});
