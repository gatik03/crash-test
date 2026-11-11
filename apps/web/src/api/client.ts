import { ApiError } from "@crash-test/shared";

type Parser<T> = { parse(data: unknown): T };

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Fetch JSON and validate it with a shared zod schema; non-2xx becomes ApiRequestError. */
async function request<T>(
  path: string,
  schema: Parser<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ApiError.safeParse(body);
    throw e.success
      ? new ApiRequestError(res.status, e.data.error.code, e.data.error.message)
      : new ApiRequestError(res.status, "http_error", `HTTP ${res.status}`);
  }
  return schema.parse(body);
}

export const getJson = <T>(path: string, schema: Parser<T>) =>
  request(path, schema);

export const postJson = <T>(path: string, body: unknown, schema: Parser<T>) =>
  request(path, schema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
