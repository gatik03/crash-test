import type { AgentLlmPayload, Scenario } from "@crash-test/shared";
import { SCRIPTS } from "../oracles/index.js";
import type { RunnableAgent } from "./scenarioRun.js";

/** `log` stores one model turn as an `agent.llm` event. */
export type ProfileContext = { log: (payload: AgentLlmPayload) => void };
export type ProfileFactory = (
  scenario: Scenario,
  ctx: ProfileContext,
) => RunnableAgent;

const PROFILES = new Map<string, ProfileFactory>();

/** LLM profiles (naive, prompted, hardened) are added through this. */
export function registerProfile(id: string, factory: ProfileFactory): void {
  PROFILES.set(id, factory);
}

export const unregisterProfile = (id: string): void => void PROFILES.delete(id);

export const getProfile = (id: string): ProfileFactory | undefined =>
  PROFILES.get(id);

export const listProfiles = (): string[] => [...PROFILES.keys()];

for (const kind of ["oracle", "saboteur"] as const) {
  // SCRIPTS is read at call time: oracles/ imports app.ts, which imports this module.
  registerProfile(kind, (scenario) => {
    const script = SCRIPTS[scenario.id]?.[kind];
    if (!script) throw new Error(`no ${kind} script for ${scenario.id}`);
    return { run: script };
  });
}
