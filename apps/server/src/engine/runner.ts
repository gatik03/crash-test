import type {
  AppEvent,
  AssertionCategory,
  AssertionSpec,
  LedgerSnapshot,
  Scenario,
} from "@crash-test/shared";
import type { Rail } from "../rails/Rail.js";
import { evaluateAssertion } from "./assertions/index.js";
import { buildAuditContext, type AssertionResult } from "./auditContext.js";
import { snapshotLedger } from "./ledger.js";
import { verdict, type Verdict } from "./verdict.js";

export type ScenarioAssertionResult = AssertionResult & {
  type: AssertionSpec["type"];
  category: AssertionCategory;
};

export type ScenarioAudit = {
  snapshot: LedgerSnapshot;
  results: ScenarioAssertionResult[];
  verdict: Verdict;
};

/** Audits one finished scenario run: ledger from rail reads, then assertions, then verdict. */
export async function runScenarioAudit({
  scenario,
  events,
  rail,
  catalog,
}: {
  scenario: Scenario;
  events: readonly AppEvent[];
  rail: Rail;
  /** Product id → category (shop/catalog.ts `CATEGORY_BY_SKU`). */
  catalog: Readonly<Record<string, string>>;
}): Promise<ScenarioAudit> {
  const { snapshot, orderIdsByRequestId } = await snapshotLedger({
    events,
    rail,
  });
  const ctx = buildAuditContext({
    scenario,
    events,
    ledger: snapshot,
    orderIdsByRequestId,
    categories: catalog,
  });
  const results = scenario.assertions.map((spec) => ({
    type: spec.type,
    category: spec.category,
    ...evaluateAssertion(ctx, spec),
  }));
  return {
    snapshot,
    results,
    verdict: verdict({
      error: false,
      feasible: scenario.feasible,
      severity: scenario.severity,
      results,
    }),
  };
}
