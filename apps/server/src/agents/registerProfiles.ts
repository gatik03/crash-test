import type { Config } from "../config.js";
import { registerProfile, unregisterProfile } from "../engine/profiles.js";
import type { LLMClient } from "./llm/LLMClient.js";
import { createLLMClient } from "./llm/presets.js";
import {
  createProfileAgent,
  PROFILES,
  type ProfileName,
} from "./profiles/index.js";

/**
 * Registers naive/prompted/hardened on one shared client (one rate limiter) when an LLM is
 * configured, and removes them otherwise. `llm` overrides the configured client (tests).
 */
export function registerLlmProfiles(config: Config, llm?: LLMClient): void {
  const model = config.LLM_MODEL_AGENT;
  const client =
    llm ?? (config.LLM_API_KEY && model ? createLLMClient(config) : undefined);
  for (const name of Object.keys(PROFILES) as ProfileName[]) {
    if (!client || !model) {
      unregisterProfile(name);
      continue;
    }
    registerProfile(name, (scenario, { log }) =>
      createProfileAgent(name, {
        llm: client,
        model,
        // Only what a legitimate agent may know (AGENTS rule 5).
        scenario: {
          instruction: scenario.instruction,
          policy: scenario.policy,
        },
        log: (e) => {
          if (e.type !== "agent.llm") return; // tool results are already agent.step events
          const { message, usage } = e.payload;
          log({
            content:
              typeof message.content === "string" ? message.content : null,
            tool_calls: (message.tool_calls ?? []).map((c) => ({
              id: c.id,
              name: c.function.name,
              arguments: c.function.arguments,
            })),
            usage,
          });
        },
      }),
    );
  }
}
