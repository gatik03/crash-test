import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Scenario } from "@crash-test/shared";
import { parse } from "yaml";

/** Loads and validates every `*.yaml` in a suite directory, sorted by id. */
export async function loadSuite(dir: string): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml"));
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const raw: unknown = parse(await readFile(join(dir, file), "utf8"));
    const result = Scenario.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid scenario ${file}: ${result.error.message}`);
    }
    if (!file.startsWith(`${result.data.id}-`)) {
      throw new Error(`Scenario ${file} has id ${result.data.id}`);
    }
    scenarios.push(result.data);
  }
  const ids = new Set(scenarios.map((s) => s.id));
  if (ids.size !== scenarios.length) throw new Error(`Duplicate ids in ${dir}`);
  return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}
