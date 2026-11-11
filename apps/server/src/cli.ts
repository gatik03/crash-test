import { parseArgs } from "node:util";
import { createServer } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { listEvents, listLedgerEntries } from "./db/repo.js";
import { listAssertionResults, listScenarioRuns } from "./db/runsRepo.js";
import { isCaptured } from "./engine/ledger.js";
import { listProfiles } from "./engine/profiles.js";
import { createLLMClient } from "./agents/llm/presets.js";
import type { LLMClient, ToolDef } from "./agents/llm/LLMClient.js";

const DEFAULT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  // The 2.5 family is closed to new keys; these answered on a fresh key (2026-11-12).
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
];

const weatherTool: ToolDef = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

async function checkModel(
  client: LLMClient,
  model: string,
): Promise<{ pass: boolean; ms: number; detail: string }> {
  const t0 = Date.now();
  try {
    const r = await client.chat({
      model,
      messages: [
        {
          role: "user",
          content: "What is the weather in Paris? Use the get_weather tool.",
        },
      ],
      tools: [weatherTool],
      temperature: 0,
      maxTokens: 256,
    });
    const call = r.toolCalls[0];
    const args = call?.args as { city?: unknown } | undefined;
    const pass =
      call?.name === "get_weather" &&
      typeof args === "object" &&
      typeof args?.city === "string";
    return {
      pass,
      ms: Date.now() - t0,
      detail: pass
        ? `get_weather(${JSON.stringify(args)}) tokens ${r.usage.in}/${r.usage.out}`
        : `no valid tool call (got ${JSON.stringify(r.toolCalls)})`,
    };
  } catch (e) {
    return {
      pass: false,
      ms: Date.now() - t0,
      detail: (e instanceof Error ? e.message : String(e))
        .replace(/\s+/g, " ")
        .slice(0, 140),
    };
  }
}

async function llmCheck(config: Config, args: string[]): Promise<number> {
  const i = args.indexOf("--models");
  const models =
    i >= 0
      ? (args[i + 1] ?? "").split(",").filter(Boolean)
      : config.LLM_PROVIDER === "gemini"
        ? DEFAULT_MODELS
        : [];
  if (models.length === 0) {
    console.error("Pass --models a,b,c");
    return 2;
  }
  const client = createLLMClient(config);
  let passed = 0;
  for (const model of models) {
    const r = await checkModel(client, model);
    if (r.pass) passed++;
    console.log(
      `${r.pass ? "PASS" : "FAIL"}  ${model.padEnd(28)} ${String(r.ms).padStart(6)} ms  ${r.detail}`,
    );
  }
  return passed > 0 ? 0 : 1;
}

/** `run --suite core-v1 --profile <id[,id]> [--scenario S06[,S07]] [--trials 1]` on the configured rail. */
async function run(config: Config, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      suite: { type: "string", default: "core-v1" },
      profile: { type: "string" },
      scenario: { type: "string" },
      trials: { type: "string", default: "1" },
    },
  });
  const { orchestrator, db } = await createServer({
    config,
    logger: false,
    boot: false,
  });
  if (!values.profile) {
    console.error(`Pass --profile (one of: ${listProfiles().join(", ")})`);
    return 2;
  }
  const runId = orchestrator.createRun({
    suite_id: values.suite,
    profile_ids: values.profile.split(","),
    ...(values.scenario && { scenario_ids: values.scenario.split(",") }),
    trials: Number(values.trials),
  });
  console.log(`run ${runId} on rail ${orchestrator.rail.kind}`);
  await orchestrator.wait(runId);

  let errors = 0;
  for (const sr of listScenarioRuns(db, runId)) {
    if (sr.verdict === "ERROR" || sr.status === "error") errors++;
    console.log(
      `\n${sr.scenario_id} ${sr.profile_id} trial ${sr.trial}: ${sr.verdict ?? "-"} (${sr.status}, ${sr.termination ?? "-"}, ${sr.steps ?? 0} steps, tokens ${sr.tokens_in ?? 0}/${sr.tokens_out ?? 0})${sr.error ? `  error: ${sr.error}` : ""}`,
    );
    for (const a of listAssertionResults(db, sr.id))
      console.log(
        `  ${a.passed ? "pass" : "FAIL"}  ${a.category.padEnd(6)} ${a.assertion_type}`,
      );
    const ledger = listLedgerEntries(db, sr.id);
    for (const e of ledger)
      console.log(
        `  ${e.kind.padEnd(7)} ${e.paypal_id}  ${e.status ?? ""}${e.amount_minor === null ? "" : `  ${e.amount_minor} ${e.currency ?? ""}`}`,
      );
    for (const e of listEvents(db, sr.id))
      if (e.type === "cleanup.refund")
        console.log(
          `  cleanup refund ${e.payload.result.refundId} ${e.payload.result.status}  ${e.payload.result.amount.minor} ${e.payload.result.amount.currency}`,
        );
    // Re-read the rail after cleanup: what is still captured.
    let left = 0;
    for (const e of ledger.filter((x) => x.kind === "order")) {
      const o = await orchestrator.rail.getOrder(e.paypal_id);
      for (const c of o.captures) {
        if (!isCaptured(c)) continue;
        left += c.amount.minor;
        for (const r of c.refunds)
          if (r.status === "COMPLETED") left -= r.amount.minor;
      }
    }
    console.log(`  still captured after cleanup: ${left} minor units`);
  }
  return errors > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "llm-check":
      return llmCheck(loadConfig(), rest);
    case "run":
      return run(loadConfig(), rest);
    default:
      console.error(
        "Usage: pnpm cli <llm-check [--models a,b,c] | run --profile <id> [--suite core-v1] [--scenario S06] [--trials 1]>",
      );
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
