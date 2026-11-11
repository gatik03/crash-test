import { describe, expect, it } from "vitest";
import type { RailOrder } from "@crash-test/shared";
import { openDb } from "./db.js";
import {
  getWallet,
  listEvents,
  listLedgerEntries,
  setWallet,
  SqliteEventSink,
  upsertLedgerEntries,
} from "./repo.js";

const usd = (minor: number) => ({ minor, currency: "USD" as const });

describe("openDb", () => {
  it("applies migrations once and records them", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "events",
        "ledger_entries",
        "runs",
        "scenario_runs",
        "wallet",
        "schema_migrations",
      ]),
    );
    expect(db.prepare("SELECT name FROM schema_migrations").all()).toEqual([
      { name: "001_init.sql" },
    ]);
  });
});

describe("SqliteEventSink", () => {
  it("numbers events per scenario run and reads them back through AppEvent", () => {
    const db = openDb(":memory:");
    const sink = new SqliteEventSink(db);
    const a = sink.append({
      scenarioRunId: "a",
      type: "run.started",
      payload: { x: 1 },
    });
    sink.append({ scenarioRunId: "b", type: "run.started", payload: {} });
    sink.append({
      scenarioRunId: "a",
      type: "rail.charge.error",
      payload: { requestId: "q", message: "boom" },
    });
    expect(a.seq).toBe(0);
    expect(Number.isNaN(Date.parse(a.ts))).toBe(false);
    const events = listEvents(db, "a");
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [0, "run.started"],
      [1, "rail.charge.error"],
    ]);
    expect(events[0]).toEqual(a);
    // A fresh sink on the same DB continues the sequence.
    expect(
      new SqliteEventSink(db).append({
        scenarioRunId: "a",
        type: "run.finished",
        payload: {},
      }).seq,
    ).toBe(2);
  });

  it("rejects an event that does not match the schema", () => {
    const sink = new SqliteEventSink(openDb(":memory:"));
    const bad = {
      scenarioRunId: "a",
      type: "rail.charge.error",
      payload: {},
    } as unknown as Parameters<SqliteEventSink["append"]>[0];
    expect(() => sink.append(bad)).toThrow();
  });
});

describe("ledger entries", () => {
  it("upserts order, capture and refund rows without duplicates", () => {
    const db = openDb(":memory:");
    const order: RailOrder = {
      id: "O1",
      status: "COMPLETED",
      items: [],
      captures: [
        { id: "C1", status: "COMPLETED", amount: usd(1749), refunds: [] },
      ],
    };
    upsertLedgerEntries(db, "sr", order);
    order.captures[0]!.status = "PARTIALLY_REFUNDED";
    order.captures[0]!.refunds.push({
      id: "R1",
      status: "COMPLETED",
      amount: usd(900),
    });
    upsertLedgerEntries(db, "sr", order);
    expect(listLedgerEntries(db, "sr")).toEqual([
      {
        kind: "order",
        paypal_id: "O1",
        parent_paypal_id: null,
        amount_minor: null,
        currency: null,
        status: "COMPLETED",
      },
      {
        kind: "capture",
        paypal_id: "C1",
        parent_paypal_id: "O1",
        amount_minor: 1749,
        currency: "USD",
        status: "PARTIALLY_REFUNDED",
      },
      {
        kind: "refund",
        paypal_id: "R1",
        parent_paypal_id: "C1",
        amount_minor: 900,
        currency: "USD",
        status: "COMPLETED",
      },
    ]);
    expect(listLedgerEntries(db, "other")).toEqual([]);
  });
});

describe("wallet", () => {
  it("is empty, then set, then updated", () => {
    const db = openDb(":memory:");
    expect(getWallet(db)).toBeNull();
    setWallet(db, {
      vaultId: "v1",
      payerEmailMasked: "b***@example.com",
      status: "VAULTED",
    });
    setWallet(db, { vaultId: "v2", status: "VAULTED" });
    expect(getWallet(db)).toMatchObject({
      vaultId: "v2",
      payerEmailMasked: null,
      status: "VAULTED",
    });
  });
});
