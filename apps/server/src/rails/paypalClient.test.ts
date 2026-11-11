import { describe, expect, it } from "vitest";
import { PAYPAL_BASE, PayPalClient } from "./paypalClient.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Response)[], calls: Call[]): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/v1/oauth2/token"))
      return Promise.resolve(
        Response.json({ access_token: "tok", expires_in: 3600 }),
      );
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    return Promise.resolve(next());
  };
}

const client = (responses: (() => Response)[], calls: Call[], now = () => 0) =>
  new PayPalClient({
    clientId: "id",
    clientSecret: "secret",
    fetch: fakeFetch(responses, calls),
    sleep: () => Promise.resolve(),
    now,
  });

const status = (s: number) => () =>
  new Response(JSON.stringify({ name: "X" }), { status: s });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe("PayPalClient", () => {
  it("talks to the sandbox host only", () => {
    expect(PAYPAL_BASE).toBe("https://api-m.sandbox.paypal.com");
  });

  it("caches the token until expires_in - 60 s", async () => {
    const calls: Call[] = [];
    let t = 0;
    const c = client([status(200), status(200), status(200)], calls, () => t);
    await c.request("GET", "/a");
    t = 3539_000;
    await c.request("GET", "/a");
    t = 3540_000;
    await c.request("GET", "/a");
    expect(calls.filter((x) => x.url.endsWith("/token"))).toHaveLength(2);
  });

  it("retries a GET on 429/5xx and returns the final response", async () => {
    const calls: Call[] = [];
    const res = await client(
      [status(503), status(429), status(200)],
      calls,
    ).request("GET", "/o");
    expect(res.status).toBe(200);
    expect(calls.filter((x) => x.url.endsWith("/o"))).toHaveLength(3);
  });

  it("does not retry a POST without a request id", async () => {
    const calls: Call[] = [];
    const res = await client([status(500)], calls).request("POST", "/o", {
      body: {},
    });
    expect(res.status).toBe(500);
  });

  it("retries a POST only with the same PayPal-Request-Id", async () => {
    const calls: Call[] = [];
    await client([status(502), status(201)], calls).request("POST", "/o", {
      body: {},
      requestId: "rq",
    });
    const posts = calls.filter((x) => x.url.endsWith("/o"));
    expect(posts.map((p) => header(p, "PayPal-Request-Id"))).toEqual([
      "rq",
      "rq",
    ]);
    expect(header(posts[0]!, "Authorization")).toBe("Bearer tok");
  });

  it("does not retry 4xx", async () => {
    const calls: Call[] = [];
    const res = await client([status(422)], calls).request("GET", "/o");
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ name: "X" });
  });
});
