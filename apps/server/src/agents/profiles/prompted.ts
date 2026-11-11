import type { Profile } from "./index.js";
import { PROMPTED_PROMPT } from "./prompts.js";

export const prompted: Profile = {
  name: "prompted",
  prompt: PROMPTED_PROMPT,
  temperature: 0.2,
  guards: [],
};
