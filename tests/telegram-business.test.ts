import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { TelegramBusinessVerifier } from "../src/auth/telegram-business.js";
import { TelegramSender } from "../src/channels/telegram-send.js";
import { normalizeTelegramUpdate, telegramIngressIdentity } from "../src/channels/telegram-normalizer.js";
import { TelegramMessagingAdapter } from "../src/adapters/telegram/messaging.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";
import { buildServer } from "../src/http/server.js";
import type { CanonicalEvent } from "../src/domain/events.js";

const token = "123456789:abcdefghijklmnopqrstuvwxyzABCDE";
const username = "ishinaillab";
const id = "connection_1";
const customerId = 7001;
const ownerId = 9001;

function bodyAsJson(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("Expected JSON text body");
  return JSON.parse(body) as Record<string, unknown>;
}

function connectionResponse(options: {
  username?: string;
  enabled?: boolean;
  canReply?: boolean;
} = {}): Response {
  return new Response(JSON.stringify({
    ok: true,
    result: {
      id, is_enabled: options.enabled ?? true,
      user: { id: ownerId, username: options.username ?? username, is_bot: false },
      rights: { can_reply: options.canReply ?? true }
    }
  }), { status: 200 });
}

function businessUpdate(updateId = 39001, options: {
  fromId?: number;
  isBot?: boolean;
  connectionId?: string;
} = {}) {
  return {
    update_id: updateId,
    business_message: {
      message_id: 14,
      business_connection_id: options.connectionId ?? id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: customerId, type: "private" },
      from: { id: options.fromId ?? customerId, is_bot: options.isBot ?? false },
      text: "How much is BIAB?"
    }
  };
}

describe("official Telegram Business account integration", () => {
  it("verifies the connected studio owner and the minimum reply permission", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(connectionResponse());
    const v = new TelegramBusinessVerifier({ botToken: token, expectedUsername: "@ishinaillab", fetchImpl });
    await expect(v.verify(id)).resolves.toEqual({ connectionId: id, ownerId: String(ownerId) });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot" + token + "/getBusinessConnection");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(bodyAsJson(init?.body)).toEqual({ business_connection_id: id });
  });

  it.each([
    { username: "some_other_account", enabled: true, canReply: true },
    { username: "ishinaiilab", enabled: true, canReply: true },
    { username, enabled: false, canReply: true },
    { username, enabled: true, canReply: false }
  ])("rejects foreign, disabled or permissionless business connections", async (options) => {
    const v = new TelegramBusinessVerifier({
      botToken: token, expectedUsername: username,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(connectionResponse(options))
    });
    await expect(v.verify(id)).rejects.toMatchObject({ retryable: false });
  });

  it("pins a verified immutable owner ID and tolerates safe username changes", async () => {
    const v = new TelegramBusinessVerifier({
      botToken: token, expectedUsername: username,
      expectedOwnerId: String(ownerId),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(connectionResponse({ username: "renamed_studio" }))
    });
    await expect(v.verify(id)).resolves.toMatchObject({ ownerId: String(ownerId) });
    const foreign = new TelegramBusinessVerifier({
      botToken: token, expectedUsername: username,
      expectedOwnerId: String(ownerId + 1),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(connectionResponse())
    });
    await expect(foreign.verify(id)).rejects.toMatchObject({ retryable: false });
  });

  it("fails closed on oversized identity read without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(16385)); }
    });
    const v = new TelegramBusinessVerifier({
      botToken: token, expectedUsername: username,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream))
    });
    await expect(v.verify(id)).rejects.toMatchObject({ retryable: true });
  });

  it("normalizes business messages and isolates business conversations from bot chats", () => {
    const [business] = normalizeTelegramUpdate(businessUpdate(), "123456789");
    const [bot] = normalizeTelegramUpdate({
      update_id: 39002,
      message: { message_id: 14, date: Math.floor(Date.now()/1000),
        chat: { id: customerId, type: "private" }, text: "hello" }
    }, "123456789");
    expect(business).toMatchObject({
      provider: "telegram", channel: "bot", eventType: "message.received",
      identityId: String(customerId), data: { businessConnectionId: id },
      content: [{ kind: "text", text: "How much is BIAB?" }]
    });
    expect(telegramIngressIdentity(business!).partitionKey)
      .not.toBe(telegramIngressIdentity(bot!).partitionKey);
  });

  it("does not allow an echoed business bot message to reach the AI", () => {
    const [business] = normalizeTelegramUpdate(businessUpdate(39003, { isBot: true }), "123456789");
    expect(business?.eventType).toBe("message.self");
    expect(new MessageReceivedHandler({
      respond: vi.fn().mockResolvedValue({ handoff: false, parts: [] })
    }).canHandle({
      id: "stored", status: "persisted",
      partitionKey: "partition", event: business as CanonicalEvent
    })).toBe(false);
  });

  it("creates an outbound action carrying the business connection and the exact customer timestamp", async () => {
    const [event] = normalizeTelegramUpdate(businessUpdate(), "123456789");
    const handler = new MessageReceivedHandler({
      respond: vi.fn().mockResolvedValue({
        handoff: false, parts: [{ kind: "text", text: "BIAB starts at 899 pesos." }]
      })
    });
    const result = await handler.handle({
      id: "stored", status: "persisted",
      partitionKey: "business-partition", event: event!
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.target).toMatchObject({
      channel: "bot", accountId: "123456789", recipientId: String(customerId),
      businessConnectionId: id
    });
    expect(result.actions[0]?.body).toMatchObject({
      customerMessageAt: event?.occurredAt
    });
  });

  it("sends to customer on behalf of the official business, not as the bot", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((url) => {
      const targetUrl = url instanceof URL ? url.toString() : typeof url === "string" ? url : url.url;
      const name = targetUrl.split("/").at(-1);
      calls.push(String(name));
      return Promise.resolve(name === "getBusinessConnection"
        ? connectionResponse()
        : new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    });
    const sender = new TelegramSender({
      botToken: token, businessUsername: username, fetchImpl
    });
    const adapter = new TelegramMessagingAdapter(sender);
    await expect(adapter.execute({
      schemaVersion: 1, idempotencyKey: "new:reply:0",
      provider: "telegram", capability: "messaging", operation: "message.send",
      orderingKey: "partition",
      target: {
        channel: "bot", accountId: "123456789",
        recipientId: String(customerId), businessConnectionId: id
      },
      body: {
        part: { kind: "text", text: "Hello from the studio" },
        customerMessageAt: new Date().toISOString()
      }
    })).resolves.toEqual({ providerResourceId: "99" });
    expect(calls).toEqual(["getBusinessConnection", "sendMessage"]);
    const payload = bodyAsJson(fetchImpl.mock.calls[1]?.[1]?.body);
    expect(payload).toEqual({
      chat_id: String(customerId), text: "Hello from the studio",
      business_connection_id: id
    });
  });

  it("blocks expired 24-hour business replies and replies to the owner", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(connectionResponse()));
    const sender = new TelegramSender({
      botToken: token, businessUsername: username, fetchImpl
    });
    await expect(sender.send(String(customerId), { kind: "text", text: "late" },
      id, new Date(Date.now() - 25 * 3600000).toISOString()))
      .rejects.toMatchObject({ retryable: false });
    await expect(sender.send(String(ownerId), { kind: "text", text: "echo" },
      id, new Date().toISOString()))
      .rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts only studio-owned business message webhooks with valid secret", async () => {
    const ingest = vi.fn().mockResolvedValue("created");
    const verifyBusinessConnection = vi.fn().mockResolvedValue({ ownerId: String(ownerId) });
    const server = buildServer({
      logger: pino({ level: "silent" }), ready: () => Promise.resolve(true),
      inbound: { ingest }, appSecret: "meta-test", verifyToken: "meta-verify",
      telegram: {
        botId: "123456789", webhookSecret: "t".repeat(32), verifyBusinessConnection
      }
    });
    const payload = businessUpdate();
    try {
      const unauthorized = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/telegram",
        headers: { "x-telegram-bot-api-secret-token": "invalid", "content-type": "application/json" },
        payload
      });
      expect(unauthorized.statusCode).toBe(401);
      const authorized = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/telegram",
        headers: { "x-telegram-bot-api-secret-token": "t".repeat(32), "content-type": "application/json" },
        payload
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toEqual({ status: "accepted" });
      expect(verifyBusinessConnection).toHaveBeenCalledOnce();
      expect(ingest).toHaveBeenCalledOnce();
      const echo = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/telegram",
        headers: { "x-telegram-bot-api-secret-token": "t".repeat(32), "content-type": "application/json" },
        payload: businessUpdate(39004, { fromId: ownerId })
      });
      expect(echo.statusCode).toBe(200);
      expect(ingest).toHaveBeenCalledOnce();
    } finally { await server.close(); }
  });

  it("retries a transient business authorizer outage without ingesting private content", async () => {
    const ingest = vi.fn();
    const server = buildServer({
      logger: pino({ level: "silent" }), ready: () => Promise.resolve(true),
      inbound: { ingest }, appSecret: "meta-test", verifyToken: "meta-verify",
      telegram: {
        botId: "123456789", webhookSecret: "t".repeat(32),
        verifyBusinessConnection: vi.fn().mockRejectedValue({ retryable: true })
      }
    });
    try {
      const response = await server.inject({
        method: "POST", url: "/ishikeit/webhooks/telegram",
        headers: { "x-telegram-bot-api-secret-token": "t".repeat(32), "content-type": "application/json" },
        payload: businessUpdate()
      });
      expect(response.statusCode).toBe(503);
      expect(ingest).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });
});
