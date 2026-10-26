import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import {
  inspectTikTokActivationConfiguration,
  tikTokActivationKeys
} from "../src/ops/tiktok-activation-preflight.js";
import type { InboundStore } from "../src/persistence/inbound.js";

const makeDeps = () => ({
  logger: pino({ level: "silent" }),
  ready: () => Promise.resolve(true),
  inbound: { ingest: vi.fn<InboundStore["ingest"]>() },
  appSecret: "private-meta-secret",
  verifyToken: "private-meta-verification-token"
});

const fullConfig = {
  TIKTOK_BUSINESS_APP_ID: "test-app-id",
  TIKTOK_BUSINESS_APP_SECRET: "synthetic-secret-123456",
  TIKTOK_BUSINESS_AUTHORIZATION_URL: "https://business-api.tiktok.com/oauth/authorize",
  TIKTOK_BUSINESS_REDIRECT_URI: "https://apps.ishinaillab.com/ishikeit/oauth/tiktok/callback/",
  TIKTOK_BUSINESS_WEBHOOK_CALLBACK_URL: "https://apps.ishinaillab.com/ishikeit/webhooks/tiktok",
  TIKTOK_BUSINESS_ID: "synthetic-business-id",
  OAUTH_CREDENTIAL_ENCRYPTION_KEY_B64: "synthetic-encryption-key",
  OPS_METRICS_TOKEN: "private-ops-token"
};

describe("read-only TikTok activation preflight", () => {
  it("reports absent configuration without inferring TikTok approval", () => {
    const result = inspectTikTokActivationConfiguration({});
    expect(result.status).toBe("configuration_incomplete");
    expect(result.missingKeys).toEqual(tikTokActivationKeys);
    expect(result.configuration).toEqual({
      appCredentials: false,
      oauthFlow: false,
      webhookManagement: false,
      accountTarget: false
    });
    expect(result.providerProductAccess).toBe("unverified");
    expect(result.accountOAuthAuthorization).toBe("unverified");
    expect(result.webhookProviderReadback).toBe("unverified");
  });

  it("cannot confuse complete runtime keys with granted TikTok permissions", () => {
    const result = inspectTikTokActivationConfiguration(fullConfig);
    expect(result.status).toBe("provider_verification_required");
    expect(result.missingKeys).toEqual([]);
    expect(result.configuration).toEqual({
      appCredentials: true,
      oauthFlow: true,
      webhookManagement: true,
      accountTarget: true
    });
    expect(result.providerProductAccess).toBe("unverified");
    expect(result.accountOAuthAuthorization).toBe("unverified");
    expect(result.webhookProviderReadback).toBe("unverified");
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain("synthetic-secret");
    expect(rendered).not.toContain("private-ops-token");
    expect(rendered).not.toContain("synthetic-business-id");
  });

  it("fails closed on whitespace-only settings", () => {
    const result = inspectTikTokActivationConfiguration({
      ...fullConfig,
      TIKTOK_BUSINESS_APP_SECRET: "  "
    });
    expect(result.status).toBe("configuration_incomplete");
    expect(result.configuration.appCredentials).toBe(false);
    expect(result.configuration.oauthFlow).toBe(false);
    expect(result.configuration.webhookManagement).toBe(false);
    expect(result.missingKeys).toEqual(["TIKTOK_BUSINESS_APP_SECRET"]);
  });

  it("rejects unauthenticated access and never caches its response", async () => {
    const server = buildServer({
      ...makeDeps(),
      opsMetricsToken: "private-ops-token",
      tiktokActivationPreflight: inspectTikTokActivationConfiguration(fullConfig)
    });
    for (const headers of [undefined, { authorization: "Bearer wrong-token" }]) {
      const res = await server.inject({
        method: "GET", url: "/ops/tiktok/activation/preflight",
        ...(headers === undefined ? {} : { headers })
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.body).not.toContain("private-ops-token");
    }
    const ok = await server.inject({
      method: "GET", url: "/ops/tiktok/activation/preflight",
      headers: { authorization: "Bearer private-ops-token" }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(ok.json()).toEqual(inspectTikTokActivationConfiguration(fullConfig));
    expect(ok.body).not.toContain("private-ops-token");
    expect(ok.body).not.toContain("synthetic-secret");
    await server.close();
  });

  it("will not expose a preflight without an operational token", async () => {
    expect(() => buildServer({
      ...makeDeps(),
      tiktokActivationPreflight: inspectTikTokActivationConfiguration(fullConfig)
    })).toThrow("TikTok activation preflight requires an operational bearer token");

    const server = buildServer(makeDeps());
    const res = await server.inject({ method: "GET", url: "/ops/tiktok/activation/preflight" });
    expect(res.statusCode).toBe(404);
    await server.close();
  });
});
