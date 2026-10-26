import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { buildServer } from "../src/http/server.js";
import type { TikTokMessagingProbeController } from "../src/messaging/tiktok-availability-probe.js";

const bearer = "o".repeat(32);
const create = (probe?: TikTokMessagingProbeController, opsMetricsToken?: string) =>
  buildServer({
    logger: pino({ level: "silent" }),
    ready: () => Promise.resolve(true),
    inbound: { ingest: vi.fn() },
    appSecret: "meta-secret",
    verifyToken: "verify-token",
    ...(probe === undefined ? {} : { tiktokMessagingAvailabilityProbe: probe }),
    ...(opsMetricsToken === undefined ? {} : { opsMetricsToken })
  });

describe("TikTok Messaging availability probe HTTP route", () => {
  it("does not exist without the optional OAuth-backed probe", async () => {
    const server = create();
    expect((await server.inject({
      method: "GET", url: "/ops/tiktok/messaging/availability-probe"
    })).statusCode).toBe(404);
    await server.close();
  });

  it("requires an ops bearer and refuses to instantiate without it", async () => {
    const probe = vi.fn().mockResolvedValue({ status: "accepted", httpStatus: 200 });
    expect(() => create({ probe })).toThrow(/operational bearer token/u);
    const server = create({ probe }, bearer);
    const denied = await server.inject({
      method: "GET", url: "/ops/tiktok/messaging/availability-probe"
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["cache-control"]).toBe("private, no-store");
    expect(probe).not.toHaveBeenCalled();
    const allowed = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/availability-probe",
      headers: { authorization: "Bearer " + bearer }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ status: "accepted", httpStatus: 200 });
    expect(probe).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("never leaks thrown errors from a provider or credential store", async () => {
    const privateMessage = "sensitive personal chat content";
    const server = create({
      probe: vi.fn().mockRejectedValue(new Error(privateMessage))
    }, bearer);
    const result = await server.inject({
      method: "GET",
      url: "/ops/tiktok/messaging/availability-probe",
      headers: { authorization: "Bearer " + bearer }
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ status: "probe_unavailable" });
    expect(result.body).not.toContain(privateMessage);
    await server.close();
  });
});
