import { nanoid } from "nanoid";
import type { Money } from "@crash-test/shared";
import type { EventSink } from "../events/sink.js";
import type { Rail } from "../rails/Rail.js";
import { CATALOG, type Product } from "./catalog.js";
import { FaultConfig, type FaultState } from "./faults.js";
import type { Quote } from "./quote.js";

export type ShopOrder = {
  orderId: string;
  captureId?: string;
  quoteId: string;
  status: string;
  quotedTotal: Money;
  createdAt: Date;
};

/**
 * Merchant-side state for one scenario run. Policy-blind (AGENTS rule 5):
 * no policy, assertions or expected outcome live here.
 */
export type ShopSession = FaultState & {
  readonly scenarioRunId: string;
  readonly catalog: readonly Product[];
  readonly cart: { id: string; items: Map<string, number> };
  readonly quotes: Map<string, Quote>;
  readonly orders: Map<string, ShopOrder>;
  readonly counters: { autoRequest: number; refund: number };
  readonly rail: Rail;
  readonly sink: EventSink;
};

export type CreateShopSessionInput = {
  scenarioRunId: string;
  /** Validated here with `FaultConfig` (scenario YAML is untrusted input). */
  faults: readonly unknown[];
  /** Slot id to the injection text already chosen for this run. */
  slots: Readonly<Record<string, string>>;
  rail: Rail;
  sink: EventSink;
};

export class ShopSessions {
  private readonly byToken = new Map<string, ShopSession>();

  createShopSession(input: CreateShopSessionInput): { token: string } {
    const faults = input.faults.map((f) => FaultConfig.parse(f));
    const catalog: Product[] = structuredClone([...CATALOG]);
    for (const f of faults) {
      if ("slot" in f && input.slots[f.slot] === undefined)
        throw new Error(`fault ${f.type}: no text for slot ${f.slot}`);
      const pid =
        f.type === "rank_override"
          ? f.first
          : f.type === "inject_description"
            ? f.product_id
            : undefined;
      if (pid !== undefined && !catalog.some((p) => p.id === pid))
        throw new Error(`fault ${f.type}: unknown product ${pid}`);
    }
    const token = `shop_${nanoid(32)}`;
    this.byToken.set(token, {
      scenarioRunId: input.scenarioRunId,
      catalog,
      faults,
      slots: { ...input.slots },
      faultHits: faults.map(() => 0),
      cart: { id: `cart_${nanoid()}`, items: new Map() },
      quotes: new Map(),
      orders: new Map(),
      counters: { autoRequest: 0, refund: 0 },
      rail: input.rail,
      sink: input.sink,
    });
    return { token };
  }

  get(token: string): ShopSession | undefined {
    return this.byToken.get(token);
  }

  end(token: string): void {
    this.byToken.delete(token);
  }
}
