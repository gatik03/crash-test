import { AppEvent, type RailOrder } from "@crash-test/shared";
import type { EventSink, NewEvent } from "../events/sink.js";
import type { Db } from "./db.js";

/** Append-only event log in SQLite; `seq` counts per scenario run and survives restarts. */
export class SqliteEventSink implements EventSink {
  private readonly nextSeq;
  private readonly insert;

  constructor(private readonly db: Db) {
    this.nextSeq = db.prepare<[string], { seq: number }>(
      "SELECT COALESCE(MAX(seq) + 1, 0) AS seq FROM events WHERE scenario_run_id = ?",
    );
    this.insert = db.prepare(
      "INSERT INTO events (scenario_run_id, seq, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
  }

  append(event: NewEvent): AppEvent {
    return this.db.transaction(() => {
      const seq = this.nextSeq.get(event.scenarioRunId)?.seq ?? 0;
      const stored = AppEvent.parse({
        ...event,
        seq,
        ts: new Date().toISOString(),
      });
      this.insert.run(
        stored.scenarioRunId,
        stored.seq,
        stored.ts,
        stored.type,
        JSON.stringify(stored.payload),
      );
      return stored;
    })();
  }
}

type EventRow = {
  scenario_run_id: string;
  seq: number;
  ts: string;
  type: string;
  payload_json: string;
};

/** Events of one scenario run in `seq` order, re-validated against the shared schema. */
export function listEvents(db: Db, scenarioRunId: string): AppEvent[] {
  return db
    .prepare<[string], EventRow>(
      "SELECT scenario_run_id, seq, ts, type, payload_json FROM events WHERE scenario_run_id = ? ORDER BY seq",
    )
    .all(scenarioRunId)
    .map((r) =>
      AppEvent.parse({
        scenarioRunId: r.scenario_run_id,
        seq: r.seq,
        ts: r.ts,
        type: r.type,
        payload: JSON.parse(r.payload_json) as unknown,
      }),
    );
}

/** Replace the ledger rows of one order (order, its captures, their refunds) for a scenario run. */
export function upsertLedgerEntries(
  db: Db,
  scenarioRunId: string,
  order: RailOrder,
): void {
  const fetchedAt = new Date().toISOString();
  const rows: [
    string,
    string,
    string | null,
    number | null,
    string | null,
    string,
    unknown,
  ][] = [["order", order.id, null, null, null, order.status, order]];
  for (const c of order.captures) {
    rows.push([
      "capture",
      c.id,
      order.id,
      c.amount.minor,
      c.amount.currency,
      c.status,
      c,
    ]);
    for (const r of c.refunds)
      rows.push([
        "refund",
        r.id,
        c.id,
        r.amount.minor,
        r.amount.currency,
        r.status,
        r,
      ]);
  }
  const del = db.prepare(
    "DELETE FROM ledger_entries WHERE scenario_run_id = ? AND paypal_id = ?",
  );
  const ins = db.prepare(
    `INSERT INTO ledger_entries (scenario_run_id, kind, paypal_id, parent_paypal_id, amount_minor, currency, status, raw_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const [kind, id, parent, minor, currency, status, raw] of rows) {
      del.run(scenarioRunId, id);
      ins.run(
        scenarioRunId,
        kind,
        id,
        parent,
        minor,
        currency,
        status,
        JSON.stringify(raw),
        fetchedAt,
      );
    }
  })();
}

export type LedgerEntry = {
  kind: "order" | "capture" | "refund";
  paypal_id: string;
  parent_paypal_id: string | null;
  amount_minor: number | null;
  currency: string | null;
  status: string | null;
};

export function listLedgerEntries(
  db: Db,
  scenarioRunId: string,
): LedgerEntry[] {
  return db
    .prepare<[string], LedgerEntry>(
      "SELECT kind, paypal_id, parent_paypal_id, amount_minor, currency, status FROM ledger_entries WHERE scenario_run_id = ? ORDER BY id",
    )
    .all(scenarioRunId);
}

export type Wallet = {
  vaultId: string | null;
  payerEmailMasked: string | null;
  status: string | null;
  updatedAt: string | null;
};

export function getWallet(db: Db): Wallet | null {
  const row = db
    .prepare<
      [],
      {
        vault_id: string | null;
        payer_email_masked: string | null;
        status: string | null;
        updated_at: string | null;
      }
    >(
      "SELECT vault_id, payer_email_masked, status, updated_at FROM wallet WHERE id = 1",
    )
    .get();
  return row
    ? {
        vaultId: row.vault_id,
        payerEmailMasked: row.payer_email_masked,
        status: row.status,
        updatedAt: row.updated_at,
      }
    : null;
}

/** Store the vaulted wallet. Pass an already-masked email only (AGENTS rule 6). */
export function setWallet(
  db: Db,
  w: { vaultId: string; payerEmailMasked?: string; status: string },
): void {
  db.prepare(
    `INSERT INTO wallet (id, vault_id, payer_email_masked, status, updated_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET vault_id = excluded.vault_id, payer_email_masked = excluded.payer_email_masked,
       status = excluded.status, updated_at = excluded.updated_at`,
  ).run(
    w.vaultId,
    w.payerEmailMasked ?? null,
    w.status,
    new Date().toISOString(),
  );
}
