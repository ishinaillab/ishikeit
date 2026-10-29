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

  it("never classifies Instagram self-originated messaging as a customer message", () => {
    for (const location of ["message", "item"] as const) {
      const item: Record<string, unknown> = {
        sender: { id: "ig-business" },
        recipient: { id: "ig-scoped-self" },
        timestamp: 1790000000000,
        message: {
          mid: "self-message-1",
          text: "message from the studio account",
          ...(location === "message" ? { is_self: true } : {})
        },
        ...(location === "item" ? { is_self: true } : {})
      };
      const [event] = normalizeMetaEnvelope({
        object: "instagram",
        entry: [{ id: "ig-business", messaging: [item] }]
      });
      expect(event).toMatchObject({
        provider: "meta",
        channel: "instagram",
        eventType: "message.self",
        providerMessageId: "self-message-1",
        data: { selfOriginated: true }
      });
      expect(event?.eventType).not.toBe("message.received");
    }
  });

  it("keeps genuine Instagram is_echo self-messaging events as echoes", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{ id: "ig-business", messaging: [{
        sender: { id: "ig-business" },
        recipient: { id: "ig-scoped-self" },
        timestamp: 1790000000000,
        message: { mid: "self-echo-1", text: "hello", is_echo: true, is_self: true }
      }] }]
    });
    expect(event).toMatchObject({
      channel: "instagram", eventType: "message.echo", identityId: "ig-scoped-self",
      data: { selfOriginated: true }
    });
  });

  it("still classifies normal Instagram customer messages as received", () => {
    const [event] = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{ id: "ig-business", messaging: [{
        sender: { id: "ig-customer" }, recipient: { id: "ig-business" },
        timestamp: 1790000000000,
        message: { mid: "customer-1", text: "How much is BIAB?" }
      }] }]
    });
    expect(event).toMatchObject({
      channel: "instagram", eventType: "message.received", identityId: "ig-customer"
    });
    expect(event?.data).toEqual({ message: { mid: "customer-1", text: "How much is BIAB?" } });
  });

  it("normalizes deleted Instagram messages as non-reply tombstones with original message correlation", () => {
    const webhook = (timestamp = 1790000000000) => ({
      object: "instagram",
      entry: [{ id: "ig-business", messaging: [{
        sender: { id: "ig-customer" }, recipient: { id: "ig-business" }, timestamp,
        message: {
          mid: "original-mid-1", is_deleted: true,
          text: "text must never become reply input",
          attachments: [{type: "image", payload: {url: "https://example.com/image.png"}}]
        }
      }] }]
    });
    const original = normalizeMetaEnvelope(webhook())[0]!;
    const redelivery = normalizeMetaEnvelope(webhook(1790000005000))[0]!;
    expect(original).toMatchObject({
      channel: "instagram", capability: "messaging", accountId: "ig-business",
      eventType: "message.deleted", providerMessageId: "original-mid-1",
      providerEventId: "delete:original-mid-1", identityId: "ig-customer",
      data: { message: { is_deleted: true, mid: "original-mid-1" } }
    });
    expect(original.content).toEqual([]);
    expect(metaIngressIdentity(original).deduplicationKey)
      .toBe(metaIngressIdentity(redelivery).deduplicationKey);
    expect(original.eventType).not.toBe("message.received");
  });

  it("keeps Instagram deletion non-reply even with echo/self flags, while normal messages remain valid", () => {
    const messages = [
      {mid: "deleted-self", is_deleted: true, is_echo: true, is_self: true},
      {mid: "deleted-missing-id", is_deleted: true},
      {mid: "real-message", text: "Price?", is_deleted: false}
    ];
    const events = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{id: "ig-business", messaging: messages.map((message) => ({
        sender: {id: "ig-customer"}, recipient: {id: "ig-business"},
        timestamp: 1790000000000, message
      }))}]
    });
    expect(events.map(event => event.eventType)).toEqual([
      "message.deleted", "message.deleted", "message.received"
    ]);
    expect(events[0]?.content).toEqual([]);
    expect(events[1]?.content).toEqual([]);
    expect(events[1]?.providerMessageId).toBe("deleted-missing-id");
    expect(events[2]?.content).toEqual([{kind: "text", text: "Price?"}]);
  });

  it("tracks Instagram edits by original message ID and revision without treating them as new messages", () => {
    const payload = (revision: number, text: string, timestamp = 1790000000000) => ({
      object: "instagram",
      entry: [{id: "ig-studio", messaging: [{
        sender: {id: "ig-customer"}, recipient: {id: "ig-studio"}, timestamp,
        message_edit: {mid: "ig-original-mid-1", text, num_edit: revision}
      }]}]
    });
    const first = normalizeMetaEnvelope(payload(1, "Corrected text"))[0]!;
    const redelivery = normalizeMetaEnvelope(
      payload(1, "Corrected text", 1790000001000), "2026-10-01T00:00:00.000Z"
    )[0]!;
    const secondEdit = normalizeMetaEnvelope(payload(2, "Corrected again"))[0]!;

    expect(first).toMatchObject({
      provider: "meta", channel: "instagram", accountId: "ig-studio",
      capability: "messaging", eventType: "message.edited",
      providerMessageId: "ig-original-mid-1",
      providerEventId: "edit:ig-original-mid-1:1",
      identityId: "ig-customer",
      content: [{kind: "structured", format: "meta.message_edit",
        data: {mid: "ig-original-mid-1", text: "Corrected text", num_edit: 1}}]
    });
    expect(metaIngressIdentity(first).deduplicationKey)
      .toBe(metaIngressIdentity(redelivery).deduplicationKey);
    expect(metaIngressIdentity(first).deduplicationKey)
      .not.toBe(metaIngressIdentity(secondEdit).deduplicationKey);
    expect(first.eventType).not.toBe("message.received");
  });

  it("preserves incomplete Instagram edit metadata without inventing a message ID or replying", () => {
    const webhook = {
      object: "instagram",
      entry: [{id: "ig-studio", messaging: [{
        sender: {id: "ig-customer"}, timestamp: 1790000000000,
        message_edit: {text: "an edited text with no original ID"}
      }]}]
    };
    const first = normalizeMetaEnvelope(webhook)[0]!;
    const retry = normalizeMetaEnvelope(webhook, "2026-10-01T00:00:00.000Z")[0]!;
    expect(first.eventType).toBe("message.edited");
    expect(first.providerMessageId).toBeUndefined();
    expect(first.providerEventId).toBeUndefined();
    expect(metaIngressIdentity(first).deduplicationKey)
      .toBe(metaIngressIdentity(retry).deduplicationKey);
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

  it("treats the current Messenger sticker webhook type as visible media plus retained metadata", () => {
    const event = normalizeMetaEnvelope({
      object: "page",
      entry: [{ id: "page-1", messaging: [{
        sender: {id: "psid-1"}, timestamp: 1790000000000,
        message: {mid: "sticker-1", attachments: [{
          type: "sticker",
          payload: {sticker_id: 369239263222822, url: "https://scontent.xx.fbcdn.net/sticker.png"}
        }]}
      }]}]
    })[0];
    expect(event?.content).toEqual([
      {kind: "image", source: {kind: "url", value: "https://scontent.xx.fbcdn.net/sticker.png"}},
      {kind: "structured", format: "meta.attachment", data: {
        type: "sticker", payload: {sticker_id: 369239263222822, url: "https://scontent.xx.fbcdn.net/sticker.png"}
      }}
    ]);
    expect(event?.eventType).toBe("message.received");
  });

  it("preserves ID-only stickers without incorrectly using sticker_id as a media attachment ID", () => {
    const event = normalizeMetaEnvelope({
      object: "page",
      entry: [{id: "page-1", messaging: [{
        sender: {id: "psid-1"}, timestamp: 1790000000000,
        message: {mid: "sticker-2", attachments: [{type: "sticker", payload: {sticker_id: 3456789}}]}
      }]}]
    })[0];
    expect(event?.content).toEqual([
      {kind: "structured", format: "meta.attachment",
        data: {type: "sticker", payload: {sticker_id: 3456789}}}
    ]);
  });

  it("handles the post-migration ig_post webhook with readable bounded title and unchanged metadata", () => {
    const largeTitle = "A".repeat(2000);
    const event = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{id: "ig-1", messaging: [{
        sender: {id: "igsid-1"}, timestamp: 1790000000000,
        message: {mid: "share-1", attachments: [
          {type: "ig_post", payload: {ig_post_media_id: "media-1", title: largeTitle,
            url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=media-1"}}
        ]}
      }]}]
    })[0];
    expect(event?.content[0]).toEqual({kind: "text", text: "Shared post: " + "A".repeat(1024)});
    expect(event?.content[1]).toMatchObject({
      kind: "structured", format: "meta.attachment",
      data: {type: "ig_post", payload: {ig_post_media_id: "media-1", title: largeTitle}}
    });
    expect(event?.content.filter((part) => part.kind === "image")).toHaveLength(0);
  });

  it("deduplicates title context when the legacy share and ig_post arrive together", () => {
    const payload = {ig_post_media_id: "media-2", title: "A quiet nail design",
      url: "https://lookaside.fbsbx.com/media-2"};
    const event = normalizeMetaEnvelope({
      object: "instagram",
      entry: [{id: "ig-1", messaging: [{
        sender: {id: "igsid-1"}, timestamp: 1790000000000,
        message: {mid: "share-2", attachments: [
          {type: "share", payload}, {type: "ig_post", payload}
        ]}
      }]}]
    })[0];
    expect(event?.content.filter((part) => part.kind === "text")).toEqual([
      {kind: "text", text: "Shared content: A quiet nail design"}
    ]);
    expect(event?.content.filter((part) => part.kind === "structured")).toHaveLength(2);
  });

  it("preserves reel shares without misclassifying their links as media downloads", () => {
    const event = normalizeMetaEnvelope({
      object: "page",
      entry: [{id: "page-1", messaging: [{
        sender: {id: "psid-1"}, timestamp: 1790000000000,
        message: {mid: "reel-1", attachments: [{
          type: "ig_reel", payload: {id: "reel-media-1", title: "Manicure inspiration",
            url: "https://facebook.com/reel/123"}
        }]}
      }]}]
    })[0];
    expect(event?.content[0]).toEqual({kind:"text", text:"Shared reel: Manicure inspiration"});
    expect(event?.content[1]).toMatchObject({kind:"structured",format:"meta.attachment"});
    expect(event?.content.filter((part) => part.kind === "video")).toHaveLength(0);
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

  it("preserves Instagram postback selection as a customer-initiated messaging event", () => {
    const envelope = {
      object: "instagram",
      entry: [{ id: "ig-business-1", messaging: [{
        sender: { id: "ig-customer-1" },
        recipient: { id: "ig-business-1" },
        timestamp: 1793192400000,
        postback: { title: "Builder gel", payload: "service_biab" }
      }] }]
    };
    const [event] = normalizeMetaEnvelope(envelope, "2026-10-28T13:00:02.000Z");
    const [redelivery] = normalizeMetaEnvelope(envelope, "2026-10-28T13:00:07.000Z");
    expect(event).toMatchObject({
      channel: "instagram",
      accountId: "ig-business-1",
      capability: "messaging",
      eventType: "message.postback",
      identityId: "ig-customer-1",
      occurredAt: "2026-10-28T13:00:00.000Z",
      content: [
        { kind: "text", text: "Builder gel" },
        { kind: "structured", format: "meta.postback", data: { payload: "service_biab" } }
      ]
    });
    expect(metaIngressIdentity(event!).deduplicationKey)
      .toBe(metaIngressIdentity(redelivery!).deduplicationKey);
  });

  it("keeps Meta delivery failures message-specific and deduplicated without sending a reply", () => {
    const envelope = {
      object: "whatsapp_business_account",
      entry: [{ id: "wa-business-1", changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: "123456789012" },
          statuses: [{
            id: "wamid-outbound-1", recipient_id: "639123456789",
            timestamp: "1793192400", status: "failed",
            errors: [{ code: 131026, title: "Message undeliverable" }]
          }]
        }
      }] }]
    };
    const [event] = normalizeMetaEnvelope(envelope);
    const [redelivery] = normalizeMetaEnvelope(envelope, "2026-10-28T13:01:00.000Z");
    expect(event).toMatchObject({
      channel: "whatsapp",
      accountId: "123456789012",
      eventType: "delivery.failed",
      capability: "messaging",
      providerMessageId: "wamid-outbound-1",
      identityId: "639123456789",
      content: []
    });
    expect(metaIngressIdentity(event!).deduplicationKey)
      .toBe(metaIngressIdentity(redelivery!).deduplicationKey);
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
