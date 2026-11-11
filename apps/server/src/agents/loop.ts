import type { Policy } from "@crash-test/shared";
import type { Tools } from "../oracles/harness.js";
import { guardedExec } from "./guards/index.js";
import type {
  AssistantMessage,
  ChatMessage,
  LLMClient,
} from "./llm/LLMClient.js";
import type { Profile } from "./profiles/index.js";
import { renderPolicy } from "./profiles/prompts.js";
import { dispatch, TOOL_DEFS, type Outcome } from "./tools.js";

export type Limits = { maxSteps: number; timeoutMs: number; tokenCap: number };
export const DEFAULT_LIMITS: Limits = {
  maxSteps: 25,
  timeoutMs: 90_000,
  tokenCap: 60_000,
};

export type AgentRunStats = {
  termination:
    | "finish"
    | "no_tool_calls"
    | "max_steps"
    | "timeout"
    | "token_cap"
    | "error";
  steps: number;
  tokensIn: number;
  tokensOut: number;
  /** Set only for `error` (infrastructure failure). */
  error?: string;
  /** The agent's `finish` summary. */
  summary?: string;
};

/** Transcript entries, for the caller to store as events. */
export type AgentLogEntry =
  | {
      type: "agent.llm";
      payload: {
        message: AssistantMessage;
        usage: { in: number; out: number };
      };
    }
  | {
      type: "agent.tool_result";
      payload: { tool_call_id: string; name: string; content: string };
    };

/** Only what a legitimate agent may know (AGENTS rule 5); a full Scenario is accepted but only these fields are read. */
export type AgentTask = { instruction: string; policy: Policy };

export type LlmAgentDeps = {
  profile: Profile;
  llm: LLMClient;
  model: string;
  scenario: AgentTask;
  limits?: Partial<Limits>;
  log?: (entry: AgentLogEntry) => void;
  now?: () => number;
};

/** System (profile prompt + policy block) and user (instruction) messages, ARCHITECTURE 5.4. */
export function renderPrompts(
  profile: Profile,
  { instruction, policy }: AgentTask,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${profile.prompt}\n\n${renderPolicy(policy)}`,
    },
    { role: "user", content: instruction },
  ];
}

const TIMEOUT = Symbol("timeout");

/**
 * The agent's time budget. It stops running while the LLM client waits on the shared rate
 * limiter or a retry backoff (`onQueue`), so queueing behind other runs is never scored as
 * an agent timeout.
 */
function budget(ms: number, now: () => number) {
  let remaining = ms;
  let since: number | undefined = now();
  const left = () =>
    since === undefined ? remaining : remaining - (now() - since);
  return {
    left,
    onQueue(queued: boolean) {
      if (queued && since !== undefined) {
        remaining = left();
        since = undefined;
      } else if (!queued && since === undefined) since = now();
    },
    /** Races `p` against the budget, polling so pauses take effect. */
    async race<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
      let timer: NodeJS.Timeout | undefined;
      const tick = (resolve: (v: typeof TIMEOUT) => void) => {
        if (left() <= 0) resolve(TIMEOUT);
        else
          timer = setTimeout(
            () => tick(resolve),
            Math.min(Math.max(1, left()), 250),
          );
      };
      try {
        return await Promise.race([p, new Promise<typeof TIMEOUT>(tick)]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const isInvalid = (o: Outcome) => {
  const e = o["error"];
  return (
    typeof e === "object" &&
    e !== null &&
    ["invalid_arguments", "unknown_tool"].includes(
      String((e as Record<string, unknown>)["code"]),
    )
  );
};

/** ARCHITECTURE 8.4: this many invalid calls in a row end the run as an agent failure. */
const MAX_INVALID_STREAK = 3;

export function createLlmAgent(deps: LlmAgentDeps): {
  run(t: Tools): Promise<AgentRunStats>;
} {
  const { profile, llm, model, scenario, log, now = Date.now } = deps;
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  return {
    async run(tools) {
      const clock = budget(limits.timeoutMs, now);
      const exec = guardedExec(profile.guards, {
        policy: scenario.policy,
        instruction: scenario.instruction,
        tools,
      });
      const messages = renderPrompts(profile, scenario);
      let steps = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let invalidStreak = 0;
      const done = (
        termination: AgentRunStats["termination"],
        extra: Pick<AgentRunStats, "error" | "summary"> = {},
      ): AgentRunStats => ({
        termination,
        steps,
        tokensIn,
        tokensOut,
        ...extra,
      });

      try {
        for (;;) {
          if (clock.left() <= 0) return done("timeout");
          const res = await clock.race(
            llm.chat({
              model,
              messages,
              tools: TOOL_DEFS,
              temperature: profile.temperature,
              onQueue: clock.onQueue,
            }),
          );
          if (res === TIMEOUT) return done("timeout");
          tokensIn += res.usage.in;
          tokensOut += res.usage.out;
          // The raw message goes back unchanged (Gemini thought signatures live in its extra fields).
          messages.push(res.message);
          log?.({
            type: "agent.llm",
            payload: { message: res.message, usage: res.usage },
          });
          if (tokensIn + tokensOut >= limits.tokenCap) return done("token_cap");
          if (res.toolCalls.length === 0) return done("no_tool_calls");

          for (const call of res.toolCalls) {
            if (call.name === "finish") {
              const s = (call.args as { summary?: unknown } | null)?.summary;
              return done(
                "finish",
                typeof s === "string" ? { summary: s } : {},
              );
            }
            if (steps >= limits.maxSteps) return done("max_steps");
            steps++;
            // Never abandoned mid-flight: a dropped confirm could capture after the audit (Shop calls are bounded).
            const out = await dispatch(call, exec);
            const content = JSON.stringify(out);
            messages.push({ role: "tool", tool_call_id: call.id, content });
            log?.({
              type: "agent.tool_result",
              payload: { tool_call_id: call.id, name: call.name, content },
            });
            invalidStreak = isInvalid(out) ? invalidStreak + 1 : 0;
            // An agent failure, audited on the ledger as it stands: not an infrastructure error.
            if (invalidStreak >= MAX_INVALID_STREAK)
              return done("no_tool_calls");
            if (clock.left() <= 0) return done("timeout");
          }
        }
      } catch (e) {
        return done("error", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
}
