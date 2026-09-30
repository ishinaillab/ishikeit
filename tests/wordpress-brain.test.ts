import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import { MediaResolverRegistry, type MediaResolver } from "../src/media/resolver.js";
import { WordPressBrainClient } from "../src/brain/wordpress.js";

const event: CanonicalEvent = {
  schemaVersion: 2,
  specversion: "1.0",
  id: "message:1",
  source: "urn:ishikeit:source:meta:whatsapp:phone-1",
  type: "com.ishikeit.messaging.message.received",
  provider: "meta",
  channel: "whatsapp",
  capability: "messaging",
  accountId: "phone-1",
  eventType: "message.received",
  identityId: "639000000000",
  receivedAt: "2026-09-30T00:00:00.000Z",
  content: [],
  data: {}
};

function registry(): MediaResolverRegistry {
  const media = new MediaResolverRegistry();
  const resolver: MediaResolver = {
    provider: "meta",
    resolve: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "photo.jpg",
      mimeType: "image/jpeg"
    })
  };
  media.register(resolver);
  return media;
}

describe("WordPressBrainClient", () => {
  it("keeps provider identity in trusted context while sending customer text as message content", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        ok: true,
        turnId: "11111111-1111-4111-8111-111111111111",
        parts: [{ kind: "text", text: "Hi" }],
        handoff: false
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    const brain = new WordPressBrainClient({
      baseUrl: "https://ishinaillab.com/wp-json/ishi-ai/v1",
      token: "bridge-token",
      mediaResolvers: registry(),
      fetchImpl
    });

    await expect(brain.respond({
      turnId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation-1",
      event,
      input: [{ kind: "text", text: "Hello" }]
    })).resolves.toEqual({
      parts: [{ kind: "text", text: "Hi" }],
      handoff: false
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://ishinaillab.com/wp-json/ishi-ai/v1/turn");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer bridge-token",
      "content-type": "application/json"
    });

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      turnId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation-1",
      message: "Hello",
      fileIds: [],
      context: {
        provider: "meta",
        channel: "whatsapp",
        capability: "messaging",
        eventType: "message.received"
      }
    });
  });

  it("resolves rich inbound media and uploads it before the AI turn", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true, file: { id: "mwai-file-1" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          ok: true,
          turnId: "11111111-1111-4111-8111-111111111111",
          parts: [{ kind: "text", text: "I can see the image." }],
          handoff: false
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ));

    const brain = new WordPressBrainClient({
      baseUrl: "https://ishinaillab.com/wp-json/ishi-ai/v1",
      token: "bridge-token",
      mediaResolvers: registry(),
      fetchImpl
    });

    await brain.respond({
      turnId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation-1",
      event,
      input: [{
        kind: "image",
        source: { kind: "provider", value: "media-1" },
        caption: "What do you think?"
      }]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://ishinaillab.com/wp-json/ishi-ai/v1/files");
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(secondBody.fileIds).toEqual(["mwai-file-1"]);
    expect(secondBody.message).toBe("What do you think?");
  });

  it("treats in-progress idempotency responses as retryable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ code: "ishi_ai_bridge_in_progress" }),
      { status: 409, headers: { "retry-after": "2" } }
    ));

    const brain = new WordPressBrainClient({
      baseUrl: "https://ishinaillab.com/wp-json/ishi-ai/v1",
      token: "bridge-token",
      mediaResolvers: registry(),
      fetchImpl
    });

    await expect(brain.respond({
      turnId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation-1",
      event,
      input: [{ kind: "text", text: "Hello" }]
    })).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 2000
    });
  });
});
