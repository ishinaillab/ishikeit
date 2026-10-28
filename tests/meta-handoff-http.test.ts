import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { InboundStore } from "../src/persistence/inbound.js";

describe("Meta operational handoff release", () => {
  it("requires an operational bearer token and rejects malformed input", async () => {
    const release = vi.fn().mockResolvedValue(true);
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest: vi.fn() } as InboundStore,
      appSecret: "secret",
      verifyToken: "verify-token",
      opsMetricsToken: "x".repeat(32),
      metaHandoffs: { release, isActive: vi.fn().mockResolvedValue(true) }
    });
    try {
      const noAuth = await server.inject({
        method: "POST",
        url: "/ops/meta/handoff/release",
        payload: { channel: "instagram", accountId: "ig-1", identityId: "person-1" }
      });
      expect(noAuth.statusCode).toBe(401);
      const invalid = await server.inject({
        method: "POST", url: "/ops/meta/handoff/release",
        headers: { authorization: "Bearer " + "x".repeat(32) },
        payload: { channel: "unsupported", accountId: "ig-1", identityId: "person-1" }
      });
      expect(invalid.statusCode).toBe(400);
      expect(release).not.toHaveBeenCalled();

      const released = await server.inject({
        method: "POST", url: "/ops/meta/handoff/release",
        headers: { authorization: "Bearer " + "x".repeat(32) },
        payload: { channel: "instagram", accountId: "ig-1", identityId: "person-1" }
      });
      expect(released.statusCode).toBe(200);
      expect(released.json()).toEqual({ status: "released" });
      expect(release).toHaveBeenCalledWith("instagram", "ig-1", "person-1");
      expect(released.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await server.close();
    }
  });
});
