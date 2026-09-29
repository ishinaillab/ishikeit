import { describe, expect, it } from "vitest";
import { ingressIdentity, normalizeMetaEnvelope } from "../src/channels/meta-normalizer.js";

describe("Meta normalizer", () => {
  it("normalizes Messenger messages with page-scoped identity", () => {
    const [event] = normalizeMetaEnvelope({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "psid-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-1", text: "hello" }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "messenger",
      accountId: "page-1",
      eventType: "message.received",
      providerEventId: "message:mid-1",
      providerMessageId: "mid-1",
      identityId: "psid-1"
    });
  });

  it("keeps Instagram identity in a separate provider namespace", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{
        id: "ig-1",
        messaging: [{
          sender: { id: "igsid-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-1", text: "hello" }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "instagram",
      accountId: "ig-1",
      eventType: "message.received",
      providerMessageId: "mid-1",
      identityId: "igsid-1"
    });
  });

  it("normalizes WhatsApp messages using the receiving phone-number account", () => {
    const [event] = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [{
              id: "wamid-1",
              from: "15551234567",
              timestamp: "1790000000",
              type: "text",
              text: { body: "hello" }
            }]
          }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "whatsapp",
      accountId: "phone-1",
      eventType: "message.received",
      providerEventId: "message:wamid-1",
      providerMessageId: "wamid-1",
      identityId: "15551234567"
    });
  });

  it("derives stable retry deduplication while separating provider partitions", () => {
    const messenger = normalizeMetaEnvelope({
      object: "page",
      entry: [{
        id: "account-1",
        messaging: [{
          sender: { id: "person-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-1", text: "hello" }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z")[0];

    const retry = normalizeMetaEnvelope({
      object: "page",
      entry: [{
        id: "account-1",
        messaging: [{
          sender: { id: "person-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-1", text: "hello" }
        }]
      }]
    }, "2026-09-29T00:01:00.000Z")[0];

    const instagram = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{
        id: "account-1",
        messaging: [{
          sender: { id: "person-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-1", text: "hello" }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z")[0];

    expect(messenger).toBeDefined();
    expect(retry).toBeDefined();
    expect(instagram).toBeDefined();

    const messengerIdentity = ingressIdentity(messenger!);
    const retryIdentity = ingressIdentity(retry!);
    const instagramIdentity = ingressIdentity(instagram!);

    expect(retryIdentity.deduplicationKey).toBe(messengerIdentity.deduplicationKey);
    expect(instagramIdentity.deduplicationKey).not.toBe(messengerIdentity.deduplicationKey);
    expect(instagramIdentity.partitionKey).not.toBe(messengerIdentity.partitionKey);
  });
});
