import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";

const productionBase = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://example",
  META_APP_SECRET: "app-secret",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-1234"
};

describe("environment", () => {
  it("keeps action dispatch disabled for literal false values", () => {
    const env = loadEnvironment({
      ...productionBase,
      ACTION_DISPATCH_ENABLED: "false",
      META_OUTBOUND_ENABLED: "false"
    });
    expect(env.ACTION_DISPATCH_ENABLED).toBe(false);
    expect(env.META_OUTBOUND_ENABLED).toBe(false);
    expect(env.ACTION_DISPATCH_ENABLED_EFFECTIVE).toBe(false);
  });

  it("enables the generic action dispatcher without requiring every provider credential", () => {
    const env = loadEnvironment({
      ...productionBase,
      ACTION_DISPATCH_ENABLED: "true"
    });
    expect(env.ACTION_DISPATCH_ENABLED_EFFECTIVE).toBe(true);
  });

  it("keeps META_OUTBOUND_ENABLED as a backward-compatible dispatcher alias", () => {
    const env = loadEnvironment({
      ...productionBase,
      META_OUTBOUND_ENABLED: "true"
    });
    expect(env.ACTION_DISPATCH_ENABLED_EFFECTIVE).toBe(true);
  });

  it("requires brain configuration and an explicit production cutover when the processor is enabled", () => {
    expect(() => loadEnvironment({
      ...productionBase,
      PROCESSOR_ENABLED: "true"
    })).toThrow();

    expect(() => loadEnvironment({
      ...productionBase,
      PROCESSOR_ENABLED: "true",
      WORDPRESS_AI_BRIDGE_URL: "https://example.test/wp-json/ishi-ai/v1",
      ISHI_AI_BRIDGE_TOKEN: "x".repeat(32)
    })).toThrow();

    const env = loadEnvironment({
      ...productionBase,
      PROCESSOR_ENABLED: "true",
      PROCESSOR_CUTOVER_AT: "2026-09-30T09:30:00.000Z",
      WORDPRESS_AI_BRIDGE_URL: "https://example.test/wp-json/ishi-ai/v1",
      ISHI_AI_BRIDGE_TOKEN: "x".repeat(32)
    });
    expect(env.PROCESSOR_ENABLED).toBe(true);
    expect(env.PROCESSOR_CUTOVER_AT).toBe("2026-09-30T09:30:00.000Z");
  });

  it("parses and normalizes provider-neutral canary partition keys", () => {
    const first = "a".repeat(64);
    const second = "B".repeat(64);
    const env = loadEnvironment({
      ...productionBase,
      PROCESSOR_CANARY_PARTITION_KEYS: ` ${first}, ${second} `
    });

    expect(env.PROCESSOR_CANARY_PARTITION_KEYS_EFFECTIVE).toEqual([
      first,
      second.toLowerCase()
    ]);
  });

  it("rejects malformed or duplicate canary partition keys", () => {
    expect(() => loadEnvironment({
      ...productionBase,
      PROCESSOR_CANARY_PARTITION_KEYS: "not-a-partition-key"
    })).toThrow();

    const duplicate = "c".repeat(64);
    expect(() => loadEnvironment({
      ...productionBase,
      PROCESSOR_CANARY_PARTITION_KEYS: `${duplicate},${duplicate}`
    })).toThrow();
  });
});
