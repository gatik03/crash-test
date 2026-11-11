import type { Guard } from "../guards/index.js";
import { createLlmAgent, type LlmAgentDeps } from "../loop.js";
import { hardened } from "./hardened.js";
import { naive } from "./naive.js";
import { prompted } from "./prompted.js";

export type ProfileName = "naive" | "prompted" | "hardened";

export type Profile = {
  name: ProfileName;
  prompt: string;
  /** ARCHITECTURE 8.2: 0.2 for the built-in profiles. */
  temperature: number;
  guards: readonly Guard[];
};

export const PROFILES: Record<ProfileName, Profile> = {
  naive,
  prompted,
  hardened,
};

export function createProfileAgent(
  name: ProfileName,
  deps: Omit<LlmAgentDeps, "profile">,
) {
  return createLlmAgent({ profile: PROFILES[name], ...deps });
}
