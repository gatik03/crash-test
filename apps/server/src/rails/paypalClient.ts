import { z } from "zod";

// Sandbox only (AGENTS rule 1, ARCHITECTURE 7.1). Never point this at the live host.
export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";

export type PayPalResponse = {
  status: number;
  debugId: string | null;
  body: unknown;
};

const ErrorBody = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

/** A non-2xx PayPal response. Carries only PayPal's error body, never credentials. */
export class PayPalHttpError extends Error {
  readonly issues: string[];
  constructor(
    readonly label: string,
    readonly status: number,
    readonly debugId: string | null,
    body: unknown,
  ) {
    const e = ErrorBody.safeParse(body);
    const issues = e.success
      ? (e.data.details ?? []).flatMap((d) => (d.issue ? [d.issue] : []))
      : [];
    const name = e.success ? (e.data.name ?? "") : "";
    super(
      `${label}: HTTP ${status} ${name} ${issues.join(",")} (debug id ${debugId ?? "?"})`,
    );
    this.name = "PayPalHttpError";
    this.issues = issues;
  }
}

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export type PayPalClientOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
};

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class PayPalClient {
  private token: { value: Promise<string>; expiresAt: number } | null = null;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxAttempts: number;

  constructor(private readonly opts: PayPalClientOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.maxAttempts = opts.maxAttempts ?? 4;
  }

  /** Cached until `expires_in − 60 s`. The token is never logged or put in errors. */
  accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt)
      return this.token.value;
    const entry = { value: Promise.resolve(""), expiresAt: Infinity };
    entry.value = this.fetchToken().then(
      ({ access_token, expires_in }) => {
        entry.expiresAt = this.now() + (expires_in - 60) * 1000;
        return access_token;
      },
      (err: unknown) => {
        if (this.token === entry) this.token = null;
        throw err;
      },
    );
    this.token = entry;
    return entry.value;
  }

  private async fetchToken(): Promise<z.infer<typeof TokenResponse>> {
    const basic = Buffer.from(
      `${this.opts.clientId}:${this.opts.clientSecret}`,
    ).toString("base64");
    const res = await this.fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const body = await readBody(res);
    if (!res.ok)
      throw new PayPalHttpError(
        "POST /v1/oauth2/token",
        res.status,
        res.headers.get("paypal-debug-id"),
        body,
      );
    return TokenResponse.parse(body);
  }

  /**
   * One REST call. Returns non-2xx responses instead of throwing.
   * GETs retry on 429/5xx; a POST retries only when it carries a PayPal-Request-Id,
   * and always with that same id, so a retry can never create a second charge.
   */
  async request(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; requestId?: string } = {},
  ): Promise<PayPalResponse> {
    const retryable = method === "GET" || opts.requestId !== undefined;
    for (let attempt = 1; ; attempt++) {
      const last = !retryable || attempt >= this.maxAttempts;
      let res: Response;
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${await this.accessToken()}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        };
        if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
        res = await this.fetch(`${PAYPAL_BASE}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        if (last || err instanceof PayPalHttpError) throw err;
        await this.sleep(backoff(attempt));
        continue;
      }
      if (!last && RETRYABLE(res.status)) {
        await res.body?.cancel();
        await this.sleep(backoff(attempt));
        continue;
      }
      return {
        status: res.status,
        debugId: res.headers.get("paypal-debug-id"),
        body: await readBody(res),
      };
    }
  }
}

const backoff = (attempt: number) => 250 * 2 ** (attempt - 1);

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export const isOk = (r: PayPalResponse) => r.status >= 200 && r.status < 300;
