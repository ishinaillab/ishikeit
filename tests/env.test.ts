import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config/env.js";

const productionBase = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://example",
  META_APP_SECRET: "app-secret",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-1234"
};

describe("environment", () => {
  it("keeps outbound delivery disabled for the literal false string", () => {
    const env = loadEnvironment({
      ...productionBase,
      META_OUTBOUND_ENABLED: "false"
    });
    expect(env.META_OUTBOUND_ENABLED).toBe(false);
  });

  it("requires all provider access tokens when outbound delivery is enabled", () => {
    expect(() => loadEnvironment({
      ...productionBase,
      META_OUTBOUND_ENABLED: "true"
    })).toThrow();

    expect(() => loadEnvironment({
      ...productionBase,
      META_OUTBOUND_ENABLED: "true",
      META_MESSENGER_ACCESS_TOKEN: "page-token",
      META_INSTAGRAM_ACCESS_TOKEN: "ig-token"
    })).toThrow();

    const env = loadEnvironment({
      ...productionBase,
      META_OUTBOUND_ENABLED: "true",
      META_MESSENGER_ACCESS_TOKEN: "page-token",
      META_INSTAGRAM_ACCESS_TOKEN: "ig-token",
      META_WHATSAPP_ACCESS_TOKEN: "wa-token"
    });
    expect(env.META_OUTBOUND_ENABLED).toBe(true);
  });
});
