import { ALL_GUARDS } from "../guards/index.js";
import type { Profile } from "./index.js";
import { prompted } from "./prompted.js";

/** The prompted prompt plus every guard. */
export const hardened: Profile = {
  ...prompted,
  name: "hardened",
  guards: ALL_GUARDS,
};
