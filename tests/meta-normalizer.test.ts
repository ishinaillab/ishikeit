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

  it("routes message echoes to the customer recipient", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{
        id: "ig-1",
        messaging: [{
          sender: { id: "ig-1" },
          recipient: { id: "igsid-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-echo-1", text: "reply", is_echo: true }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "instagram",
      accountId: "ig-1",
      eventType: "message.echo",
      providerMessageId: "mid-echo-1",
      identityId: "igsid-1"
    });

    expect(ingressIdentity(event!).partitionKey).toBe(
      ingressIdentity({
        ...event!,
        eventType: "message.received",
        identityId: "igsid-1"
      }).partitionKey
    );
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
  it("normalizes Messenger attachments into provider-neutral rich content", () => {
    const [event] = normalizeMetaEnvelope({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "psid-1" },
          timestamp: 1790000000000,
          message: {
            mid: "mid-media-1",
            attachments: [{
              type: "image",
              payload: { url: "https://scontent.xx.fbcdn.net/photo.jpg" }
            }, {
              type: "file",
              payload: { url: "https://scontent.xx.fbcdn.net/file.pdf", name: "file.pdf" }
            }]
          }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event?.content).toEqual([
      {
        kind: "image",
        source: { kind: "url", value: "https://scontent.xx.fbcdn.net/photo.jpg" }
      },
      {
        kind: "document",
        source: { kind: "url", value: "https://scontent.xx.fbcdn.net/file.pdf" },
        filename: "file.pdf"
      }
    ]);
  });

  it("normalizes WhatsApp media IDs without downloading before the webhook ACK", () => {
    const [event] = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [{
              id: "wamid-media-1",
              from: "15551234567",
              timestamp: "1790000000",
              type: "document",
              document: {
                id: "media-1",
                mime_type: "application/pdf",
                filename: "reference.pdf",
                caption: "Please check this"
              }
            }]
          }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event?.content).toEqual([{
      kind: "document",
      source: { kind: "provider", value: "media-1" },
      mimeType: "application/pdf",
      filename: "reference.pdf",
      caption: "Please check this"
    }]);
  });

});
