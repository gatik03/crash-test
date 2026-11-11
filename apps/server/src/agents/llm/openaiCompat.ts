import { z } from "zod";
import {
  LLMError,
  type AssistantMessage,
  type ChatRequest,
  type ChatResult,
  type LLMClient,
  type ToolCall,
  type ToolDef,
  type WireToolCall,
} from "./LLMClient.js";
import type { RateLimiter } from "./rateLimit.js";

export interface OpenAICompatOptions {
  baseURL: string;
  apiKey: string;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Retries after the first attempt on 429, 5xx and network errors. */
  maxRetries?: number;
  timeoutMs?: number;
}

const Response_ = z.object({
  choices: z
    .array(
      z.object({
        message: z.looseObject({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.looseObject({
                id: z.string().nullish(),
                function: z.looseObject({
                  name: z.string(),
                  arguments: z.unknown(),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

/** First JSON value found in text: the whole text, a fenced block, or the first balanced {...} that parses. */
export function extractJson(text: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(text.trim());
  if (whole !== undefined) return whole;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const inFence = fenced?.[1] ? tryParse(fenced[1].trim()) : undefined;
  if (inFence !== undefined) return inFence;
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const v = tryParse(text.slice(i, j + 1));
        if (v !== undefined) return v;
        break;
      }
    }
  }
  return undefined;
}

/** Arguments may be an object, a JSON string, or a messy string. An unparseable string is returned as is. */
export function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  if (raw.trim() === "") return {};
  return extractJson(raw) ?? raw;
}

/** A tool call a model wrote into its text: `{"name": ..., "arguments"|"parameters": ...}`. */
function embeddedCall(
  content: string,
  tools: ToolDef[],
): { name: string; args: unknown } | undefined {
  const v = extractJson(content);
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (
    typeof o["name"] !== "string" ||
    !tools.some((t) => t.function.name === o["name"])
  )
    return undefined;
  return {
    name: o["name"],
    args: parseArgs(o["arguments"] ?? o["parameters"]),
  };
}

export function parseChatResponse(
  body: unknown,
  tools: ToolDef[] = [],
): ChatResult {
  const parsed = Response_.safeParse(body);
  if (!parsed.success) throw new LLMError("Unexpected LLM response shape");
  const raw = parsed.data.choices[0]!.message;
  const message = { ...raw, role: "assistant" } as AssistantMessage;
  message.content = raw.content ?? null;

  let toolCalls: ToolCall[] = (raw.tool_calls ?? []).map((c, i) => ({
    id: c.id || `call_${i}`,
    name: c.function.name,
    args: parseArgs(c.function.arguments),
  }));
  if (toolCalls.length === 0 && raw.content && tools.length > 0) {
    const e = embeddedCall(raw.content, tools);
    if (e) toolCalls = [{ id: "call_0", ...e }];
  }
  if (toolCalls.length > 0) {
    // Echo-safe: every call has an id, so tool results can reference it.
    const original = raw.tool_calls ?? [];
    message.tool_calls = toolCalls.map((c, i): WireToolCall => ({
      ...(original[i] as object | undefined),
      id: c.id,
      type: "function",
      function: {
        name: c.name,
        arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args),
      },
    }));
  }
  return {
    message,
    toolCalls,
    usage: {
      in: parsed.data.usage?.prompt_tokens ?? 0,
      out: parsed.data.usage?.completion_tokens ?? 0,
    },
  };
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 120_000) : undefined;
}

export function createOpenAICompatClient(opts: OpenAICompatOptions): LLMClient {
  const {
    apiKey,
    limiter,
    fetch: fetchFn = fetch,
    sleep = realSleep,
    random = Math.random,
    maxRetries = 3,
    timeoutMs = 120_000,
  } = opts;
  const url = new URL(
    "chat/completions",
    opts.baseURL.endsWith("/") ? opts.baseURL : `${opts.baseURL}/`,
  );
  const redact = (s: string): string => s.split(apiKey).join("[redacted]");

  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      const body = JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      });
      for (let attempt = 0; ; attempt++) {
        req.onQueue?.(true);
        await limiter.acquire();
        req.onQueue?.(false);
        let res: Response | undefined;
        let failure = "";
        try {
          res = await fetchFn(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          failure = redact(e instanceof Error ? e.message : String(e));
        }
        if (res?.ok) {
          return parseChatResponse(await res.json(), req.tools);
        }
        const status = res?.status;
        const retryable = !res || status === 429 || (status ?? 0) >= 500;
        if (res) {
          failure = redact((await res.text().catch(() => "")).slice(0, 300));
        }
        if (!retryable || attempt >= maxRetries) {
          throw new LLMError(
            `LLM request failed${status ? ` (HTTP ${status})` : ""}: ${failure}`,
            status,
          );
        }
        req.onQueue?.(true);
        await sleep(
          retryAfterMs(res?.headers.get("retry-after") ?? null) ??
            Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + random() / 2),
        );
      }
    },
  };
}
