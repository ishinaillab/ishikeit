import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { MetaGraphTokenPreflight } from "../src/security/meta-graph-preflight.js";
import { buildServer } from "../src/http/server.js";

const secret = "test-secret-only";
const pageToken = "synthetic-page-token";
const waToken = "synthetic-whatsapp-token";
const appId = "1042452472116584";
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

describe("read-only Meta Graph proof compatibility preflight", () => {
  it("verifies token issuer before performing only signed GET /me canaries", async () => {
    const seen: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const target = new URL(typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url);
      seen.push({ url: target, init });
      expect(target.hostname).toBe("graph.facebook.com");
      expect(target.protocol).toBe("https:");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      if (target.pathname.endsWith("/debug_token")) {
        expect(target.searchParams.get("input_token")).toMatch(/^synthetic-/u);
        expect((init?.headers as Record<string, string>).authorization)
          .toBe(`Bearer ${appId}|${secret}`);
        return Promise.resolve(response({ data: { app_id: appId, is_valid: true } }));
      }
      expect(target.pathname).toBe("/v26.0/me");
      const bearer = (init?.headers as Record<string, string>).authorization;
      expect(bearer).toMatch(/^Bearer synthetic-/u);
      expect(target.searchParams.get("appsecret_proof")).toMatch(/^[a-f0-9]{64}$/u);
      return Promise.resolve(response({ id: "synthetic-provider-identity" }));
    });
    const client = new MetaGraphTokenPreflight({
      appId, appSecret: secret, graphVersion: "v26.0",
      messengerToken: pageToken, whatsappToken: waToken,
      fetchImpl
    });
    const result = await client.probe();
    expect(result.channels).toEqual({
      messenger: "proof_compatible", whatsapp: "proof_compatible"
    });
    expect(result.graphProofFlagUnchanged).toBe(true);
    expect(seen).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain(pageToken);
    expect(JSON.stringify(result)).not.toContain(waToken);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("fails closed on wrong issuer, invalid and unavailable tokens without signed calls", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ data: { app_id: "99999", is_valid: true } })));
    const client = new MetaGraphTokenPreflight({
      appId, appSecret: secret, graphVersion: "v26.0",
      messengerToken: pageToken,
      fetchImpl
    });
    const result = await client.probe();
    expect(result.channels).toEqual({messenger:"wrong_app", whatsapp:"not_configured"});
    expect(fetchImpl).toHaveBeenCalledOnce();
    const invalid = new MetaGraphTokenPreflight({
      appId, appSecret: secret, graphVersion: "v26.0", messengerToken: pageToken,
      fetchImpl: vi.fn(() => Promise.resolve(response({data:{app_id:appId,is_valid:false}})))
    });
    expect((await invalid.probe()).channels.messenger).toBe("invalid_token");
  });

  it("protects preflight endpoint with ops bearer and does not echo credentials", async () => {
    const probe = vi.fn().mockResolvedValue({
      checkedAt: "2026-10-29T00:00:00.000Z", graphProofFlagUnchanged:true,
      channels: { messenger:"proof_compatible",whatsapp:"not_configured" }
    });
    const server = buildServer({
      logger:pino({level:"silent"}),ready:()=>Promise.resolve(true),
      inbound:{ingest:vi.fn()},appSecret:"secret",verifyToken:"verify",
      opsMetricsToken:"x".repeat(32),metaGraphPreflight:{probe}
    });
    try {
      const unauth = await server.inject({method:"GET",url:"/ops/meta/graph-proof-preflight"});
      expect(unauth.statusCode).toBe(401);
      expect(probe).not.toHaveBeenCalled();
      const result=await server.inject({method:"GET",url:"/ops/meta/graph-proof-preflight",
        headers:{authorization:"Bearer "+"x".repeat(32)}});
      expect(result.statusCode).toBe(200);
      expect(result.json<{status:string}>().status).toBe("ok");
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(probe).toHaveBeenCalledOnce();
    }finally{await server.close();}
  });
});
