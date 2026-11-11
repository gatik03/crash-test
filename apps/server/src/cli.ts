import { loadConfig, type Config } from "./config.js";
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

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "llm-check":
      return llmCheck(loadConfig(), rest);
    case "run":
      console.log("not implemented yet");
      return 0;
    default:
      console.error("Usage: pnpm cli <llm-check [--models a,b,c] | run>");
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
