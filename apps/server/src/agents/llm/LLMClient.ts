/** Provider-agnostic chat interface. Message and tool shapes follow the OpenAI chat API. */

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** JSON Schema for the arguments object. */
    parameters: Record<string, unknown>;
  };
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Raw assistant message as returned by the API; extra fields (e.g. Gemini `extra_content`) must be echoed back unchanged. */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: WireToolCall[];
  [extra: string]: unknown;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments. A string means the model sent unparseable JSON: report `invalid_arguments` (ARCHITECTURE 8.4). */
  args: unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  message: AssistantMessage;
  toolCalls: ToolCall[];
  usage: { in: number; out: number };
}

export interface LLMClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

/** Failure after retries. The message never contains the API key. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
