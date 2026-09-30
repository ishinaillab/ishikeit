import pino from "pino";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import type { InboundStore } from "../src/persistence/inbound.js";

function makeServer(store: InboundStore, webhookBodyLimit?: number) {
  return buildServer({
    logger: pino({ level: "silent" }),
    ready: () => Promise.resolve(true),
    inbound: store,
    appSecret: "secret",
    verifyToken: "verify-token-1234",
    ...(webhookBodyLimit === undefined ? {} : { webhookBodyLimit })
  });
}

function signedHeaders(raw: string) {
  return {
    "content-type": "application/json",
    "x-hub-signature-256": "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex")
  };
}

describe("Meta webhook route", () => {
  it("exposes runtime contract metadata without secrets", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const server = makeServer({ ingest });

    const res = await server.inject({
      method: "GET",
      url: "/health/capabilities"
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      service: "ishikeit",
      architecture: "event-action-v1",
      canonicalEventSchema: 2,
      actionSchema: 1,
      wordpressBridgeApiSchema: 1,
      wordpressBridgeStorageSchema: "1.1.1",
      runtime: {
        processorEnabled: false,
        actionDispatchEnabled: false
      }
    });
    await server.close();
  });


  it("exposes configured runtime gates without secrets", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const server = buildServer({
      logger: pino({ level: "silent" }),
      ready: () => Promise.resolve(true),
      inbound: { ingest },
      appSecret: "secret",
      verifyToken: "verify-token-1234",
      runtimeState: {
        processorEnabled: true,
        actionDispatchEnabled: true
      }
    });

    const res = await server.inject({
      method: "GET",
      url: "/health/capabilities"
    });

    const body = res.json<{
      runtime: {
        processorEnabled: boolean;
        actionDispatchEnabled: boolean;
      };
    }>();
    expect(body.runtime).toEqual({
      processorEnabled: true,
      actionDispatchEnabled: true
    });
    expect(res.body).not.toContain("secret");
    await server.close();
  });

  it("answers the GET challenge", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);

    const res = await server.inject({
      method: "GET",
      url: "/ishikeit/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-1234&hub.challenge=abc"
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("abc");
    await server.close();
  });

  it("rejects bad signatures before persistence", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=" + "0".repeat(64)
      },
      payload: '{"object":"page","entry":[]}'
    });

    expect(res.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects signed invalid JSON before persistence", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = '{"object":';

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(422);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });

  it("durably accepts a signed event", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockResolvedValue("created");
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = JSON.stringify({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "user-1" },
          timestamp: 1790000000000,
          message: { mid: "m-1", text: "hello" }
        }]
      }]
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: {
        ...signedHeaders(raw),
        "content-type": "application/json; charset=utf-8"
      },
      payload: raw
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "accepted" });
    expect(ingest).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("does not acknowledge a database failure", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>().mockRejectedValue(new Error("database unavailable"));
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store);
    const raw = JSON.stringify({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "user-1" },
          timestamp: 1790000000000,
          message: { mid: "m-2", text: "retry me" }
        }]
      }]
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(500);
    await server.close();
  });

  it("enforces the webhook body limit before processing", async () => {
    const ingest = vi.fn<InboundStore["ingest"]>();
    const store = { ingest } satisfies InboundStore;
    const server = makeServer(store, 32);
    const raw = JSON.stringify({
      object: "page",
      entry: [{ id: "page-1", messaging: [] }],
      padding: "x".repeat(100)
    });

    const res = await server.inject({
      method: "POST",
      url: "/ishikeit/webhooks/meta",
      headers: signedHeaders(raw),
      payload: raw
    });

    expect(res.statusCode).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
    await server.close();
  });
});
