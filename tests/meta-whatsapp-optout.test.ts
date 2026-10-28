import { describe, expect, it, vi } from "vitest";
import { normalizeMetaEnvelope } from "../src/channels/meta-normalizer.js";
import { messageSendBodySchema } from "../src/domain/actions.js";
import {
  isWhatsAppTemplateOptOut,
  WHATSAPP_OPT_OUT_CONFIRMATION
} from "../src/domain/meta-whatsapp-optout.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";
import type { BrainClient } from "../src/brain/types.js";

function makeStored(text: string): StoredInboundEvent {
  const [event] = normalizeMetaEnvelope({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "123456789012" },
      messages: [{
        id: "wamid-stop-1", from: "639123456789", timestamp: "1793192400",
        type: "text", text: { body: text }
      }]
    } }] }]
  }, "2026-10-28T14:20:00.000Z");
  if (event === undefined) throw new Error("WhatsApp fixture failed normalization");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    partitionKey: "a".repeat(64),
    status: "persisted",
    event
  };
}

describe("WhatsApp STOP/UNSUBSCRIBE functional response", () => {
  it("recognizes only explicit customer intent, not ordinary conversation", () => {
    for (const text of ["stop", " STOP ", "Unsubscribe", "STOP REMINDERS"]) {
      expect(isWhatsAppTemplateOptOut(makeStored(text).event)).toBe(true);
    }
    for (const text of ["please stop by the studio", "how do I unsubscribe?", "stop that", "start reminders"]) {
      expect(isWhatsAppTemplateOptOut(makeStored(text).event)).toBe(false);
    }
    const messenger = { ...makeStored("STOP").event, channel: "messenger" };
    expect(isWhatsAppTemplateOptOut(messenger)).toBe(false);
  });

  it("acknowledges a signed, fresh STOP once without consulting AI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T14:20:00.000Z"));
    try {
      const respond = vi.fn<BrainClient["respond"]>();
      const handler = new MessageReceivedHandler({ respond });
      const stored = makeStored("Stop Reminders");
      const result = await handler.handle(stored);
      expect(result.outcome).toBe("handled");
      expect(result.actions).toHaveLength(1);
      const [action] = result.actions;
      expect(action?.target).toMatchObject({
        channel: "whatsapp", accountId: "123456789012", recipientId: "639123456789"
      });
      const body = messageSendBodySchema.parse(action?.body);
      expect(body.part).toEqual({ kind: "text", text: WHATSAPP_OPT_OUT_CONFIRMATION });
      expect(body.customerMessageAt).toBe(stored.event.occurredAt);
      expect(respond).not.toHaveBeenCalled();
      expect((await handler.handle(stored)).actions).toEqual(result.actions);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send an opt-out confirmation after the WhatsApp service window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T14:20:00.000Z"));
    try {
      const respond = vi.fn<BrainClient["respond"]>();
      const handler = new MessageReceivedHandler({ respond });
      const result = await handler.handle(makeStored("STOP"));
      expect(result).toEqual({ actions: [], outcome: "ignored" });
      expect(respond).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
