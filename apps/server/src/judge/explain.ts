import { Explanation, type ExplanationResponse } from "@crash-test/shared";
import type { Db } from "../db/db.js";
import type { ChatMessage, LLMClient } from "../agents/llm/LLMClient.js";
import { buildJudgePrompt, citable, type JudgeInput } from "./prompts.js";

/** Strip code fences and surrounding prose, then parse. Returns undefined if no JSON object. */
function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Keep only citations that exist in the input; null when nothing valid remains. */
function dropHallucinated(
  e: Explanation,
  input: JudgeInput,
): Explanation | null {
  const { seqs, ids } = citable(input);
  const evidence = e.evidence
    .map((c) =>
      typeof c === "string" && /^(event:)?\d+$/.test(c)
        ? Number(c.replace("event:", ""))
        : c,
    )
    .filter((c) => (typeof c === "number" ? seqs.has(c) : ids.has(c)));
  if (evidence.length === 0) return null;
  return {
    ...e,
    evidence,
    offending_step:
      e.offending_step !== null && seqs.has(e.offending_step)
        ? e.offending_step
        : null,
  };
}

/** Explains an already-decided verdict. Never throws for LLM failures: null means "failed". */
export async function explainScenarioRun({
  llm,
  model,
  input,
}: {
  llm: LLMClient;
  model: string;
  input: JudgeInput;
}): Promise<Explanation | null> {
  const messages: ChatMessage[] = buildJudgePrompt(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const res = await llm.chat({
        model,
        messages,
        temperature: 0,
        maxTokens: 2000,
      });
      text = res.message.content ?? "";
    } catch {
      return null;
    }
    const json = parseJson(text);
    const parsed = Explanation.safeParse(json);
    if (parsed.success) return dropHallucinated(parsed.data, input);
    messages.push(
      { role: "assistant", content: text },
      {
        role: "user",
        content: `That reply was invalid: ${json === undefined ? "not a JSON object" : parsed.error.message}\nReply again with only the corrected JSON object.`,
      },
    );
  }
  return null;
}

/** Stores the judge's result; null records a failed judge (status `failed`). */
export function saveExplanation(
  db: Db,
  scenarioRunId: string,
  explanation: Explanation | null,
  model: string,
): void {
  db.prepare(
    "INSERT OR REPLACE INTO explanations (scenario_run_id, json, model, created_at) VALUES (?, ?, ?, ?)",
  ).run(
    scenarioRunId,
    JSON.stringify(explanation),
    model,
    new Date().toISOString(),
  );
}

/** `ready` with a valid stored explanation, `failed` for any other stored row, `none` without one. */
export function explanationStatus(
  db: Db,
  scenarioRunId: string,
): ExplanationResponse {
  const row = db
    .prepare<[string], { json: string | null }>(
      "SELECT json FROM explanations WHERE scenario_run_id = ?",
    )
    .get(scenarioRunId);
  if (!row) return { status: "none", explanation: null };
  let json: unknown = null;
  try {
    json = JSON.parse(row.json ?? "null");
  } catch {
    // Unreadable row: failed.
  }
  const parsed = Explanation.safeParse(json);
  return parsed.success
    ? { status: "ready", explanation: parsed.data }
    : { status: "failed", explanation: null };
}

export function getExplanation(
  db: Db,
  scenarioRunId: string,
): Explanation | null {
  return explanationStatus(db, scenarioRunId).explanation;
}
