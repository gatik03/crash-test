import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const sandbox = {
  PAYPAL_RAIL: "paypal-sandbox",
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "id",
  PAYPAL_CLIENT_SECRET: "secret",
  WALLET_VAULT_ID: "vault",
};

describe("loadConfig", () => {
  it("defaults to the mock rail with no PayPal vars", () => {
    expect(loadConfig({})).toEqual({
      PORT: 3000,
      PAYPAL_RAIL: "mock",
      PAYPAL_ENV: "sandbox",
      DATABASE_PATH: "data/crash-test.db",
      LLM_MAX_RPM: 10,
      DEMO_MODE: "local",
      ALLOW_LIVE_RUNS: true,
      LIVE_RUNS_PER_IP_PER_DAY: 3,
      LIVE_RUNS_GLOBAL_PER_DAY: 30,
      CLEANUP_REFUNDS_DEFAULT: true,
      RUN_CONCURRENCY: 2,
      JUDGE_TIMEOUT_MS: 90000,
    });
  });

  it("defaults model roles to the verified gemini-3.x ids for gemini only", () => {
    expect(
      loadConfig({ LLM_PROVIDER: "gemini", LLM_MODEL_JUDGE: "j" }),
    ).toMatchObject({
      LLM_MODEL_AGENT: "gemini-3.5-flash",
      LLM_MODEL_JUDGE: "j",
      LLM_MODEL_GENERATOR: "gemini-3.1-flash-lite",
    });
    expect(
      loadConfig({ LLM_PROVIDER: "nvidia" }).LLM_MODEL_AGENT,
    ).toBeUndefined();
  });

  it("validates LLM settings", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai" })).toThrow(
      /LLM_PROVIDER/,
    );
    expect(() => loadConfig({ LLM_MAX_RPM: "0" })).toThrow(/LLM_MAX_RPM/);
    expect(() => loadConfig({ LLM_BASE_URL: "nope" })).toThrow(/LLM_BASE_URL/);
    expect(loadConfig({ LLM_MAX_RPM: "30" }).LLM_MAX_RPM).toBe(30);
  });

  it("accepts a complete sandbox config", () => {
    expect(loadConfig({ ...sandbox, PORT: "8080" })).toMatchObject({
      PORT: 8080,
      PAYPAL_RAIL: "paypal-sandbox",
    });
  });

  it("rejects a non-sandbox PAYPAL_ENV for the paypal rail", () => {
    expect(() => loadConfig({ ...sandbox, PAYPAL_ENV: "live" })).toThrow(
      /PAYPAL_ENV/,
    );
  });

  it("requires credentials and vault id for the paypal rail, without echoing values", () => {
    let message = "";
    try {
      loadConfig({ ...sandbox, PAYPAL_CLIENT_ID: "", WALLET_VAULT_ID: "" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/PAYPAL_CLIENT_ID/);
    expect(message).toMatch(/WALLET_VAULT_ID/);
    expect(message).not.toMatch(/secret/);
  });

  it("rejects an unknown rail", () => {
    expect(() => loadConfig({ PAYPAL_RAIL: "live" })).toThrow(/PAYPAL_RAIL/);
  });
});
