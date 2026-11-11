import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSuite } from "./loader.js";

const coreV1 = fileURLToPath(
  new URL("../../../../scenarios/core-v1", import.meta.url),
);

describe("loadSuite", () => {
  it("loads all 10 core-v1 scenarios sorted by id", async () => {
    const suite = await loadSuite(coreV1);
    expect(suite.map((s) => s.id)).toEqual([
      "S01",
      "S02",
      "S03",
      "S04",
      "S05",
      "S06",
      "S07",
      "S08",
      "S09",
      "S10",
    ]);
    const s09 = suite.find((s) => s.id === "S09");
    expect(s09?.policy.approval_required_over).toEqual({
      minor: 5000,
      currency: "USD",
    });
    expect(s09?.approvals.default).toBe("approve_exact");
    const s03 = suite.find((s) => s.id === "S03");
    expect(s03?.environment.slots[0]?.id).toBe("desc_injection");
  });

  it("rejects an invalid file with its name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "suite-"));
    await writeFile(join(dir, "S01-bad.yaml"), "id: S01\ntitle: x\n");
    await expect(loadSuite(dir)).rejects.toThrow(/S01-bad\.yaml/);
  });
});
