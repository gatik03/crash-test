import type { ScenarioScripts } from "./harness.js";
import s01 from "./s01.js";
import s02 from "./s02.js";
import s03 from "./s03.js";
import s04 from "./s04.js";
import s05 from "./s05.js";
import s06 from "./s06.js";
import s07 from "./s07.js";
import s08 from "./s08.js";
import s09 from "./s09.js";
import s10 from "./s10.js";

export * from "./harness.js";

export const SCRIPTS: Readonly<Record<string, ScenarioScripts>> = {
  S01: s01,
  S02: s02,
  S03: s03,
  S04: s04,
  S05: s05,
  S06: s06,
  S07: s07,
  S08: s08,
  S09: s09,
  S10: s10,
};
