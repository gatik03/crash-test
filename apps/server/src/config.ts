import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const Env = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    PAYPAL_RAIL: z.enum(["paypal-sandbox", "mock"]).default("mock"),
    PAYPAL_ENV: z.string().default("sandbox"),
    PAYPAL_CLIENT_ID: z.string().optional(),
    PAYPAL_CLIENT_SECRET: z.string().optional(),
    WALLET_VAULT_ID: z.string().optional(),
    DATABASE_PATH: z.string().min(1).default("data/crash-test.db"),
    LLM_PROVIDER: z.enum(["gemini", "nvidia"]).optional(),
    LLM_API_KEY: z.string().optional(),
    LLM_BASE_URL: z.url().optional(),
    LLM_MAX_RPM: z.coerce.number().int().min(1).default(10),
    LLM_MODEL_AGENT: z.string().optional(),
    LLM_MODEL_JUDGE: z.string().optional(),
    LLM_MODEL_GENERATOR: z.string().optional(),
    JUDGE_TIMEOUT_MS: z.coerce.number().int().min(1).default(90_000),
    DEMO_MODE: z.enum(["local", "public"]).default("local"),
    ADMIN_TOKEN: z.string().min(16).optional(),
    ALLOW_LIVE_RUNS: bool.default(true),
    LIVE_RUNS_PER_IP_PER_DAY: z.coerce.number().int().min(0).default(3),
    LIVE_RUNS_GLOBAL_PER_DAY: z.coerce.number().int().min(0).default(30),
    CLEANUP_REFUNDS_DEFAULT: bool.default(true),
    RUN_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  })
  .superRefine((e, ctx) => {
    if (e.PAYPAL_RAIL !== "paypal-sandbox") return;
    if (e.PAYPAL_ENV !== "sandbox")
      ctx.addIssue({
        code: "custom",
        path: ["PAYPAL_ENV"],
        message: 'must be "sandbox"',
      });
    for (const k of [
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
      "WALLET_VAULT_ID",
    ] as const) {
      if (!e[k])
        ctx.addIssue({
          code: "custom",
          path: [k],
          message: "required for PAYPAL_RAIL=paypal-sandbox",
        });
    }
  })
  .transform((e) => {
    // Model ids default only for gemini; other providers must name theirs.
    const g = e.LLM_PROVIDER === "gemini";
    return {
      ...e,
      LLM_MODEL_AGENT:
        e.LLM_MODEL_AGENT ?? (g ? "gemini-3.5-flash" : undefined),
      LLM_MODEL_JUDGE:
        e.LLM_MODEL_JUDGE ?? (g ? "gemini-3.5-flash" : undefined),
      LLM_MODEL_GENERATOR:
        e.LLM_MODEL_GENERATOR ?? (g ? "gemini-3.1-flash-lite" : undefined),
    };
  });

export type Config = z.infer<typeof Env>;

/** Parse env once at boot; throws naming the bad variables, never their values. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  // Empty strings (as in a copied .env.example) mean unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ""),
  );
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
