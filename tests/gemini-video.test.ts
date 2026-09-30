import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../src/domain/events.js";
import { GeminiVideoInterpreter } from "../src/media/gemini-video.js";

const event: CanonicalEvent = {
  schemaVersion: 2,
  specversion: "1.0",
  id: "message:video-1",
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

const part = {
  kind: "video" as const,
  source: { kind: "provider", value: "media-1" },
  caption: "Please check this"
};

const media = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  filename: "clip.mp4",
  mimeType: "video/mp4"
};

describe("GeminiVideoInterpreter", () => {
  it("uploads, waits for readiness, interprets statelessly, and deletes the temporary file", async () => {
    const fileUri = "https://generativelanguage.googleapis.com/v1beta/files/file-1";
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/v1beta/files/session-1"
        }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file: { name: "files/file-1", uri: fileUri, mimeType: "video/mp4" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "ACTIVE",
        uri: fileUri,
        mimeType: "video/mp4"
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: "A close-up shows pink nails with ribbon details." }]
        }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const interpreter = new GeminiVideoInterpreter({
      apiKey: "test-gemini-api-key",
      model: "gemini-3.8-flash",
      fetchImpl,
      pollIntervalMs: 1
    });

    await expect(interpreter.interpret(event, part, media)).resolves.toEqual({
      text: "A close-up shows pink nails with ribbon details.",
      backend: "gemini",
      model: "gemini-3.8-flash"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[0]?.[0])
      .toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
    expect(fetchImpl.mock.calls[4]?.[0])
      .toBe("https://generativelanguage.googleapis.com/v1beta/files/file-1");

    const interactionCall = fetchImpl.mock.calls[3];
    expect(interactionCall?.[0])
      .toBe("https://generativelanguage.googleapis.com/v1/interactions");
    const init = interactionCall?.[1];
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-gemini-api-key" });

    if (typeof init?.body !== "string") throw new Error("expected JSON interaction body");
    const body = JSON.parse(init.body) as {
      model: string;
      store: boolean;
      input: Array<Record<string, unknown>>;
    };
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.store).toBe(false);
    expect(body.input[0]).toMatchObject({
      type: "video",
      uri: fileUri,
      mime_type: "video/mp4",
      processing: "static"
    });
    expect(body.input[1]).toMatchObject({ type: "text" });
  });

  it("declines unsupported video MIME types without sending bytes to a backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const interpreter = new GeminiVideoInterpreter({
      apiKey: "test-gemini-api-key",
      fetchImpl
    });

    await expect(interpreter.interpret(event, part, {
      ...media,
      mimeType: "application/octet-stream"
    })).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies quota responses as retryable and honors Retry-After", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: "quota" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "3"
        }
      }
    ));

    const interpreter = new GeminiVideoInterpreter({
      apiKey: "test-gemini-api-key",
      fetchImpl
    });

    await expect(interpreter.interpret(event, part, media)).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 3000
    });
  });

  it("refuses a resumable upload URL outside Google APIs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "x-goog-upload-url": "https://example.com/upload/session-1" }
    }));

    const interpreter = new GeminiVideoInterpreter({
      apiKey: "test-gemini-api-key",
      fetchImpl
    });

    await expect(interpreter.interpret(event, part, media)).rejects.toMatchObject({
      retryable: false
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
