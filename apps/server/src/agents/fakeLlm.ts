import type {
  ChatRequest,
  ChatResult,
  LLMClient,
  WireToolCall,
} from "./llm/LLMClient.js";

/** One scripted model turn, given the last tool result (parsed JSON) of the conversation. */
export type Turn = (lastToolResult: unknown) => {
  calls?: { name: string; args: unknown }[];
  text?: string;
  usage?: { in: number; out: number };
};

/** Test double: replays preset turns, records every request. No network. */
export function fakeLlm(
  turns: Turn[],
): LLMClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    async chat(req): Promise<ChatResult> {
      const { onQueue, ...plain } = req; // functions cannot be cloned
      onQueue?.(false);
      requests.push(structuredClone(plain));
      const turn = turns[requests.length - 1];
      if (!turn) throw new Error("fake LLM script exhausted");
      const lastTool = req.messages.findLast((m) => m.role === "tool");
      const out = turn(
        lastTool &&
          "content" in lastTool &&
          typeof lastTool.content === "string"
          ? JSON.parse(lastTool.content)
          : undefined,
      );
      const toolCalls = (out.calls ?? []).map((c, j) => ({
        id: `call_${requests.length}_${j}`,
        ...c,
      }));
      const wire = toolCalls.map(
        (c): WireToolCall & { extra_content: unknown } => ({
          id: c.id,
          type: "function",
          function: {
            name: c.name,
            arguments:
              typeof c.args === "string" ? c.args : JSON.stringify(c.args),
          },
          extra_content: { google: { thought_signature: `sig-${c.id}` } },
        }),
      );
      return {
        message: {
          role: "assistant",
          content: out.text ?? null,
          ...(wire.length > 0 && { tool_calls: wire }),
        },
        toolCalls,
        usage: out.usage ?? { in: 10, out: 5 },
      };
    },
  };
}
