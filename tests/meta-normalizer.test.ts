import { describe, expect, it } from "vitest";
import { metaIngressIdentity, normalizeMetaEnvelope } from "../src/channels/meta-normalizer.js";

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

    expect(metaIngressIdentity(event!).partitionKey).toBe(
      metaIngressIdentity({
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

    const messengerIdentity = metaIngressIdentity(messenger!);
    const retryIdentity = metaIngressIdentity(retry!);
    const instagramIdentity = metaIngressIdentity(instagram!);

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

  it("normalizes Instagram standby messages as routing-only events", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{
        id: "ig-1",
        standby: [{
          sender: { id: "igsid-standby-1" },
          recipient: { id: "ig-1" },
          timestamp: 1790000000000,
          message: { mid: "mid-standby-1", text: "hello from standby" }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "instagram",
      capability: "routing",
      accountId: "ig-1",
      eventType: "standby.message",
      providerEventId: "standby:message:mid-standby-1",
      providerMessageId: "mid-standby-1",
      identityId: "igsid-standby-1",
      content: []
    });
  });

  it("normalizes Instagram handover events as routing-only events", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{
        id: "ig-1",
        messaging: [{
          sender: { id: "igsid-handover-1" },
          recipient: { id: "ig-1" },
          timestamp: 1790000000000,
          pass_thread_control: {
            previous_owner_app_id: "app-old",
            new_owner_app_id: "app-new"
          }
        }]
      }]
    }, "2026-09-29T00:00:00.000Z");

    expect(event).toMatchObject({
      channel: "instagram",
      capability: "routing",
      accountId: "ig-1",
      eventType: "handover.pass",
      identityId: "igsid-handover-1",
      content: []
    });
  });

  it("splits Messenger delivery batches into message-specific, retry-idempotent receipts", () => {
    const payload = {
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "psid-1" },
          recipient: { id: "page-1" },
          timestamp: 1790000000000,
          delivery: { mids: ["mid-out-1", "mid-out-2", "mid-out-1"], watermark: 1790000000000 }
        }]
      }]
    };
    const events = normalizeMetaEnvelope(payload, "2026-09-29T00:00:00.000Z");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.providerMessageId)).toEqual(["mid-out-1", "mid-out-2"]);
    for (const event of events) {
      expect(event.eventType).toBe("delivery.delivered");
      expect(event.channel).toBe("messenger");
      expect(event.capability).toBe("messaging");
    }
    const retried = normalizeMetaEnvelope(payload, "2026-09-29T00:05:00.000Z");
    expect(metaIngressIdentity(events[0]!).deduplicationKey).toBe(
      metaIngressIdentity(retried[0]!).deduplicationKey
    );
    expect(metaIngressIdentity(events[0]!).deduplicationKey).not.toBe(
      metaIngressIdentity(events[1]!).deduplicationKey
    );
  });

  it("makes WhatsApp interactive selections readable while keeping source data", () => {
    const messages = [
      { id: "wamid-1", from: "639120000000", type: "interactive", timestamp: "1790000000",
        interactive: { type: "button_reply", button_reply: { id: "book", title: "Book an appointment" } } },
      { id: "wamid-2", from: "639120000000", type: "interactive", timestamp: "1790000001",
        interactive: { type: "list_reply", list_reply: { id: "biab", title: "BIAB", description: "Builder gel" } } },
      { id: "wamid-3", from: "639120000000", type: "button", timestamp: "1790000002",
        button: { payload: "confirm", text: "Confirm" } }
    ];
    const events = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{ id: "business-1", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "phone-1" }, messages
      } }] }]
    });
    expect(events.map((event) => event.content[0])).toEqual([
      { kind: "text", text: "Book an appointment" },
      { kind: "text", text: "BIAB" },
      { kind: "text", text: "Confirm" }
    ]);
    expect(events.every((event) => event.content[1]?.kind === "structured")).toBe(true);
    expect(events.map((event) => event.eventType)).toEqual([
      "message.received", "message.received", "message.received"
    ]);
  });

  it("correlates Instagram message-specific seen receipts and deduplicates retries", () => {
    const webhook = {
      object: "instagram",
      entry: [{ id: "ig-1", messaging: [{
        sender: { id: "igsid-1" },
        timestamp: 1790000000000,
        read: { mid: "mid-outbound-1" }
      }] }]
    };
    const [event] = normalizeMetaEnvelope(webhook);
    const [retry] = normalizeMetaEnvelope(webhook, "2026-10-01T00:00:00.000Z");
    expect(event).toMatchObject({
      channel: "instagram",
      accountId: "ig-1",
      eventType: "delivery.read",
      providerMessageId: "mid-outbound-1"
    });
    expect(metaIngressIdentity(event!).deduplicationKey)
      .toBe(metaIngressIdentity(retry!).deduplicationKey);
  });

  it("preserves Messenger watermark-only reads without fabricating a message ID", () => {
    const [event] = normalizeMetaEnvelope({
      object: "page",
      entry: [{ id: "page-1", messaging: [{
        sender: { id: "psid-1" },
        timestamp: 1790000000000,
        read: { watermark: 1790000000000 }
      }] }]
    });
    expect(event).toMatchObject({ eventType: "delivery.read", channel: "messenger" });
    expect(event?.providerMessageId).toBeUndefined();
  });

  it("normalizes customer Messenger postback selections with a stable identity", () => {
    const payload = {
      object: "page",
      entry: [{ id: "page-1", messaging: [{
        sender: { id: "psid-1" },
        recipient: { id: "page-1" },
        timestamp: 1790000000000,
        postback: { title: "Book an appointment", payload: "open_booking" }
      }] }]
    };
    const [event] = normalizeMetaEnvelope(payload);
    expect(event).toMatchObject({
      provider: "meta",
      channel: "messenger",
      capability: "messaging",
      eventType: "message.postback",
      identityId: "psid-1",
      content: [
        { kind: "text", text: "Book an appointment" },
        { kind: "structured", format: "meta.postback", data: { payload: "open_booking" } }
      ]
    });
    const [retried] = normalizeMetaEnvelope(payload, "2026-10-01T00:00:00.000Z");
    expect(metaIngressIdentity(event!).deduplicationKey)
      .toBe(metaIngressIdentity(retried!).deduplicationKey);
  });

  it("does not reject valid Messenger messages beside an invalid timestamp", () => {
    const events = normalizeMetaEnvelope({
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "psid-bad" },
          timestamp: 1e30,
          message: { mid: "mid-bad-time", text: "old" }
        }, {
          sender: { id: "psid-good" },
          timestamp: 1793192400000,
          message: { mid: "mid-good-time", text: "new" }
        }]
      }]
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.providerMessageId).toBe("mid-bad-time");
    expect(events[0]?.occurredAt).toBeUndefined();
    expect(events[1]?.providerMessageId).toBe("mid-good-time");
    expect(events[1]?.occurredAt).toBe("2026-10-28T13:00:00.000Z");
  });

  it("handles malformed WhatsApp epoch seconds without dropping adjacent valid messages", () => {
    const events = normalizeMetaEnvelope({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{ field: "messages", value: {
          metadata: { phone_number_id: "phone-1" },
          messages: [{
            id: "wamid-bad", from: "639000000000", type: "text",
            timestamp: "9999999999999999999999", text: { body: "bad timestamp" }
          }, {
            id: "wamid-good", from: "639000000000", type: "text",
            timestamp: "1793192400", text: { body: "valid timestamp" }
          }]
        } }]
      }]
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.occurredAt).toBeUndefined();
    expect(events[1]?.occurredAt).toBe("2026-10-28T13:00:00.000Z");
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
