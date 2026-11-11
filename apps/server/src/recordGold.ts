import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { writeFixture } from "./api/replay.js";
import { createServer, FIXTURES_DIR } from "./app.js";
import type { Config } from "./config.js";
import { listEvents } from "./db/repo.js";
import { listScenarioRuns } from "./db/runsRepo.js";

const LLM_PROFILES = new Set(["naive", "prompted", "hardened"]);

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
      force: { type: "boolean", default: false },
    },
  });
  if (config.PAYPAL_RAIL !== "paypal-sandbox") {
    console.error(
      "record-gold needs PAYPAL_RAIL=paypal-sandbox: gold runs are never recorded on the mock rail.",
    );
    return 2;
  }
  const profiles = values.profiles.split(",");
  const llmProfile = profiles.some((p) => LLM_PROFILES.has(p));
  const missing = [
    ...(llmProfile && !config.LLM_API_KEY ? ["LLM_API_KEY"] : []),
    ...(llmProfile && !(values.model ?? config.LLM_MODEL_AGENT)
      ? ["LLM_MODEL_AGENT (or --model)"]
      : []),
    ...(config.LLM_MODEL_JUDGE ? [] : ["LLM_MODEL_JUDGE"]),
  ];
  if (missing.length > 0) {
    console.error(`record-gold needs ${missing.join(", ")} before charging.`);
    return 2;
  }
  const target = values.name ? join(dir, `${values.name}.json`) : undefined;
  if (target && existsSync(target) && !values.force) {
    console.error(`${target} exists; pass --force to overwrite it.`);
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
    profile_ids: profiles,
    ...(values.scenarios && { scenario_ids: values.scenarios.split(",") }),
    trials: Number(values.trials),
  });
  console.log(`recording ${runId} on the PayPal sandbox…`);
  await orchestrator.wait(runId); // includes the judge explanations
  const runs = listScenarioRuns(db, runId);
  for (const sr of runs) {
    const captures = listEvents(db, sr.id).filter(
      (e) => e.type === "rail.charge.result",
    ).length;
    console.log(
      `${sr.scenario_id} ${sr.profile_id} trial ${sr.trial}: ${sr.verdict ?? "-"} (${sr.status}) captures ${captures} explanation ${orchestrator.explanation(sr.id).status}`,
    );
  }
  console.log(`wrote ${writeFixture(db, runId, dir, values.name ?? runId)}`);
  const errored = runs.filter((r) => r.status === "error");
  if (errored.length > 0) {
    console.error(
      `${errored.length} scenario run(s) ended in error: ${errored.map((r) => `${r.scenario_id}/${r.profile_id}`).join(", ")}`,
    );
    return 1;
  }
  return 0;
}
