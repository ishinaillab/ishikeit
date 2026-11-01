import { describe, expect, it, vi } from "vitest";
import type { BrainClient } from "../src/brain/types.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";
import { explicitLinks } from "../src/processing/explicit-links.js";

const bookingUrl = "https://www.ishinaillab.com/?ishi_booking_slot=eyJzZXJ2aWNlX2lkIjoxLCJkYXRlIjoiMjAyNi0xMS0wMyJ9.test-signature";
const linked = `8 AM is available.\\n[Complete Your Booking](${bookingUrl})\\nFinish checkout to reserve.`;

describe("channel-safe clickable links", () => {
  it("preserves the signed URL byte for byte and replaces literal markdown link syntax", () => {
    const result = explicitLinks(linked);
    expect(result).toContain(`Complete Your Booking: ${bookingUrl}`);
    expect(result).not.toContain("[Complete Your Booking](");
    expect((result.match(/https:\/\//gu) ?? [])).toHaveLength(1);
  });

  it("does not change raw URLs, ordinary text, or non-http link expressions", () => {
    expect(explicitLinks("Plain https://ishinaillab.com and *bold* text")).toBe("Plain https://ishinaillab.com and *bold* text");
    expect(explicitLinks("[private](javascript:alert(1))")).toBe("[private](javascript:alert(1))");
  });

  it.each(["messenger", "instagram", "whatsapp", "bot"] as const)(
    "converts AI links into customer-visible URLs before publishing a %s action",
    async (channel) => {
      const provider = channel === "bot" ? "telegram" : "meta";
      const stored: StoredInboundEvent = {
        id: "11111111-1111-4111-8111-111111111111",
        partitionKey: `p-${channel}`,
        status: "persisted",
        event: {
          schemaVersion: 2,
          specversion: "1.0",
          id: `message-${channel}`,
          source: `urn:ishikeit:source:${provider}:${channel}:owned-account`,
          type: "com.ishikeit.messaging.message.received",
          provider, channel, capability: "messaging",
          accountId: "owned-account", eventType: "message.received",
          identityId: "test-customer", providerMessageId: "customer-1",
          occurredAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          content: [{kind: "text", text: "can I book?"}],
          data: {}
        }
      };
      const respond = vi.fn<BrainClient["respond"]>().mockResolvedValue({
        handoff: false, parts: [{kind: "text", text: linked}]
      });
      const r = await new MessageReceivedHandler({respond}).handle(stored);
      expect(r.outcome).toBe("handled");
      expect(r.actions).toHaveLength(1);
      expect(r.actions[0]?.body).toMatchObject({
        part: { kind: "text", text: explicitLinks(linked) }
      });
      expect(respond).toHaveBeenCalledOnce();
    }
  );
});
