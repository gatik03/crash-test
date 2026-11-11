// Fails if any source file names a live (non-sandbox) PayPal host (AGENTS rule 1, ARCHITECTURE 7.1).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LIVE_HOST = /\b(?:api-m|api|www)\.paypal\.com\b/;

// Tracked plus untracked-but-not-ignored files, so node_modules, dist and .env are skipped.
// Markdown is prose (the spec names the live host to forbid it), not source.
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(
    (f) => f && !f.endsWith(".md") && !/(^|\/)(node_modules|dist)\//.test(f),
  );

const hits: string[] = [];
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  text.split("\n").forEach((line, i) => {
    if (LIVE_HOST.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error("Live PayPal host found (sandbox only):\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`check:sandbox-only: ${files.length} files clean`);
