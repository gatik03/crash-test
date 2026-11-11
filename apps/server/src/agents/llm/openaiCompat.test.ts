import { describe, expect, it } from "vitest";
import { LLMError, type ToolDef } from "./LLMClient.js";
import { createOpenAICompatClient, parseChatResponse } from "./openaiCompat.js";

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  },
];

const reply = (message: Record<string, unknown>) => ({
  choices: [{ message: { role: "assistant", ...message } }],
  usage: { prompt_tokens: 3, completion_tokens: 4 },
});

const call = (args: unknown) =>
  reply({
    content: null,
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: { name: "get_weather", arguments: args },
      },
    ],
  });

describe("parseChatResponse", () => {
  it("parses string arguments and usage", () => {
    const r = parseChatResponse(call('{"city":"Paris"}'), tools);
    expect(r.toolCalls).toEqual([
      { id: "c1", name: "get_weather", args: { city: "Paris" } },
    ]);
    expect(r.usage).toEqual({ in: 3, out: 4 });
  });

  it("accepts object arguments, fills missing ids, keeps extra fields", () => {
    const body = reply({
      content: null,
      extra_content: { google: { thought_signature: "sig" } },
      tool_calls: [
        {
          id: "",
          type: "function",
          function: { name: "get_weather", arguments: { city: "Rome" } },
        },
      ],
    });
    const r = parseChatResponse(body, tools);
    expect(r.toolCalls[0]).toEqual({
      id: "call_0",
      name: "get_weather",
      args: { city: "Rome" },
    });
    expect(r.message["extra_content"]).toEqual({
      google: { thought_signature: "sig" },
    });
    expect(r.message.tool_calls?.[0]?.id).toBe("call_0");
  });

  it("repairs fenced or padded JSON and keeps hopeless arguments as a string", () => {
    expect(
      parseChatResponse(call('```json\n{"city":"Oslo"}\n```'), tools)
        .toolCalls[0]?.args,
    ).toEqual({ city: "Oslo" });
    expect(
      parseChatResponse(call('Here: {"city":"Oslo"} done'), tools).toolCalls[0]
        ?.args,
    ).toEqual({ city: "Oslo" });
    expect(parseChatResponse(call('{"city": '), tools).toolCalls[0]?.args).toBe(
      '{"city": ',
    );
    expect(parseChatResponse(call(""), tools).toolCalls[0]?.args).toEqual({});
  });

  it("extracts a tool call embedded in content, only for known tools", () => {
    const text =
      'I will check.\n```json\n{"name":"get_weather","parameters":{"city":"Paris"}}\n```';
    const r = parseChatResponse(reply({ content: text }), tools);
    expect(r.toolCalls).toEqual([
      { id: "call_0", name: "get_weather", args: { city: "Paris" } },
    ]);
    expect(r.message.tool_calls?.[0]?.function.arguments).toBe(
      '{"city":"Paris"}',
    );
    expect(
      parseChatResponse(
        reply({ content: '{"name":"rm_rf","arguments":{}}' }),
        tools,
      ).toolCalls,
    ).toEqual([]);
    expect(parseChatResponse(reply({ content: text })).toolCalls).toEqual([]);
  });

  it("rejects a malformed envelope", () => {
    expect(() => parseChatResponse({ choices: [] })).toThrow(LLMError);
  });
});

describe("createOpenAICompatClient", () => {
  const KEY = "sk-secret-key-123";
  const json = (
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) => new Response(JSON.stringify(body), { status, headers });
  const make = (responses: Array<Response | Error>, sleeps: number[] = []) => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAICompatClient({
      baseURL: "https://example.test/v1",
      apiKey: KEY,
      limiter: { acquire: async () => {} },
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init as RequestInit });
        const next = responses.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 1,
    });
    return { client, seen };
  };
  const req = {
    model: "m",
    messages: [{ role: "user" as const, content: "hi" }],
    tools,
  };

  it("posts to chat/completions with a bearer key", async () => {
    const { client, seen } = make([json(call('{"city":"Paris"}'))]);
    const r = await client.chat({ ...req, temperature: 0, maxTokens: 9 });
    expect(r.toolCalls[0]?.name).toBe("get_weather");
    expect(seen[0]?.url).toBe("https://example.test/v1/chat/completions");
    expect(
      (seen[0]?.init.headers as Record<string, string>)["authorization"],
    ).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(seen[0]?.init.body))).toMatchObject({
      model: "m",
      temperature: 0,
      max_tokens: 9,
    });
  });

  it("retries 429 honoring Retry-After, then 5xx with backoff", async () => {
    const sleeps: number[] = [];
    const { client } = make(
      [
        json({}, 429, { "retry-after": "7" }),
        json({}, 503),
        json(reply({ content: "ok" })),
      ],
      sleeps,
    );
    expect((await client.chat(req)).message.content).toBe("ok");
    expect(sleeps).toEqual([7000, 2000]);
  });

  it("gives up after 3 retries and does not retry 4xx", async () => {
    const four = make([
      json({}, 500),
      json({}, 500),
      json({}, 500),
      json({}, 500),
    ]);
    await expect(four.client.chat(req)).rejects.toMatchObject({ status: 500 });
    expect(four.seen).toHaveLength(4);
    const bad = make([json({ error: "bad" }, 400)]);
    await expect(bad.client.chat(req)).rejects.toMatchObject({ status: 400 });
    expect(bad.seen).toHaveLength(1);
  });

  it("never leaks the key in errors", async () => {
    const echo = make([new Response(`invalid key ${KEY}`, { status: 401 })]);
    const err = await echo.client.chat(req).catch((e: unknown) => e as Error);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain("[redacted]");
    const net = make(
      Array.from({ length: 4 }, () => new Error(`connect failed for ${KEY}`)),
    );
    const err2 = await net.client.chat(req).catch((e: unknown) => e as Error);
    expect(err2.message).not.toContain(KEY);
  });
});
