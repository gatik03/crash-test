import type { Config } from "../../config.js";
import type { LLMClient } from "./LLMClient.js";
import { createOpenAICompatClient } from "./openaiCompat.js";
import { createRateLimiter } from "./rateLimit.js";

export const PRESET_BASE_URLS = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  nvidia: "https://integrate.api.nvidia.com/v1",
} as const;

/** One client (and so one rate limiter) shared by every role: agent, judge, generator. */
export function createLLMClient(config: Config): LLMClient {
  if (!config.LLM_API_KEY) throw new Error("LLM_API_KEY is not set");
  const baseURL =
    config.LLM_BASE_URL ??
    (config.LLM_PROVIDER ? PRESET_BASE_URLS[config.LLM_PROVIDER] : undefined);
  if (!baseURL) throw new Error("Set LLM_PROVIDER or LLM_BASE_URL");
  return createOpenAICompatClient({
    baseURL,
    apiKey: config.LLM_API_KEY,
    limiter: createRateLimiter(config.LLM_MAX_RPM),
  });
}
