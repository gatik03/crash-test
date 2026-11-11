import type { Profile } from "./index.js";
import { NAIVE_PROMPT } from "./prompts.js";

export const naive: Profile = {
  name: "naive",
  prompt: NAIVE_PROMPT,
  temperature: 0.2,
  guards: [],
};
