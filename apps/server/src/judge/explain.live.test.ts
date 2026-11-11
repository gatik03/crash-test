import { describe, expect, it } from "vitest";
import { createLLMClient } from "../agents/llm/presets.js";
import { loadConfig } from "../config.js";
import { explainScenarioRun } from "./explain.js";
import { doubleCaptureInput } from "./testInput.js";

// Real Gemini call; needs LLM_* in the environment (e.g. `node --env-file=.env`). Skipped unless JUDGE_LIVE=1.
describe.skipIf(!process.env.JUDGE_LIVE)("judge live", () => {
  it("explains a synthetic S06 double capture", async () => {
    const config = loadConfig();
    const out = await explainScenarioRun({
      llm: createLLMClient(config),
      model: config.LLM_MODEL_JUDGE ?? "",
      input: doubleCaptureInput,
    });
    console.log(JSON.stringify(out, null, 1));
    expect(out).not.toBeNull();
  }, 120_000);
});
