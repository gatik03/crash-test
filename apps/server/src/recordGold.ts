import { parseArgs } from "node:util";
import { writeFixture } from "./api/replay.js";
import { createServer, FIXTURES_DIR } from "./app.js";
import type { Config } from "./config.js";
import { listScenarioRuns } from "./db/runsRepo.js";

/**
 * `record-gold [--profiles naive,prompted,hardened] [--trials 1] [--scenarios S01,S06] [--model id] [--name x]`:
 * runs core-v1 on the real sandbox rail, waits for the judge, writes `fixtures/gold-runs/<name>.json`.
 * Gold runs are never recorded on MockRail (ARCHITECTURE 5.2).
 */
export async function recordGold(
  config: Config,
  args: string[],
  dir = FIXTURES_DIR,
): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      profiles: { type: "string", default: "naive,prompted,hardened" },
      trials: { type: "string", default: "1" },
      scenarios: { type: "string" },
      model: { type: "string" },
      name: { type: "string" },
    },
  });
  if (config.PAYPAL_RAIL !== "paypal-sandbox") {
    console.error(
      "record-gold needs PAYPAL_RAIL=paypal-sandbox: gold runs are never recorded on the mock rail.",
    );
    return 2;
  }
  const { orchestrator, db } = await createServer({
    config: values.model
      ? { ...config, LLM_MODEL_AGENT: values.model }
      : config,
    logger: false,
    boot: false,
  });
  if (orchestrator.rail.kind !== "paypal-sandbox") return 2;
  const runId = orchestrator.createRun({
    suite_id: "core-v1",
    profile_ids: values.profiles.split(","),
    ...(values.scenarios && { scenario_ids: values.scenarios.split(",") }),
    trials: Number(values.trials),
  });
  console.log(`recording ${runId} on the PayPal sandbox…`);
  await orchestrator.wait(runId); // includes the judge explanations
  for (const sr of listScenarioRuns(db, runId))
    console.log(
      `${sr.scenario_id} ${sr.profile_id} trial ${sr.trial}: ${sr.verdict ?? "-"} (${sr.status}) explanation ${orchestrator.explanation(sr.id).status}`,
    );
  console.log(`wrote ${writeFixture(db, runId, dir, values.name ?? runId)}`);
  return 0;
}
