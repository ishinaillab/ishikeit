import { describe, expect, it, vi } from "vitest";
import type { BrainClient } from "../src/brain/types.js";
import { normalizeMetaEnvelope, metaIngressIdentity } from "../src/channels/meta-normalizer.js";
import {
  WHATSAPP_APPOINTMENT_OPT_IN_PHRASE,
  WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION,
  isWhatsAppAppointmentOptIn
} from "../src/domain/meta-whatsapp-optin.js";
import { MessageReceivedHandler } from "../src/processing/message-handler.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";
import type { PostgresDatabase, SqlExecutor } from "../src/persistence/postgres.js";
import { PostgresInboundStore } from "../src/persistence/inbound.js";
import { PostgresWhatsAppConsentStore } from "../src/persistence/whatsapp-consent.js";

const ACCOUNT = "123456789012";
const RECIPIENT = "639123456789";
const NOW = new Date("2026-10-28T14:20:00.000Z");

function eventFor(text: string) {
  const [event] = normalizeMetaEnvelope({
    object: "whatsapp_business_account",
    entry: [{ id: "business-1", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: ACCOUNT },
      messages: [{
        id: "wamid-consent-test", from: RECIPIENT, timestamp: "1793197140",
        type: "text", text: { body: text }
      }]
    } }] }]
  }, NOW.toISOString());
  if (event === undefined) throw new Error("missing normalized fixture");
  return event;
}

describe("Explicit WhatsApp appointment opt-in", () => {
  it("requires exact business, channel, category and unsubscribe notice", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(isWhatsAppAppointmentOptIn(eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE))).toBe(true);
      for (const text of ["YES", "Yes reminders", "Book BIAB", "I agree to receive updates",
        "I agree to receive WhatsApp appointment reminders", "STOP REMINDERS"]) {
        expect(isWhatsAppAppointmentOptIn(eventFor(text))).toBe(false);
      }
      expect(isWhatsAppAppointmentOptIn({ ...eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE),
        channel: "instagram" })).toBe(false);
      expect(isWhatsAppAppointmentOptIn({ ...eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE),
        eventType: "message.echo" })).toBe(false);
      expect(isWhatsAppAppointmentOptIn({ ...eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE),
        occurredAt: "2020-01-01T00:00:00.000Z" })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inserts a source-linked explicit opt-in between durable inbound insert and queue event", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const calls: string[] = [];
      const query = vi.fn().mockImplementation((sql: string) => {
        calls.push(sql.includes("INSERT INTO inbound_events") ? "inbound"
          : sql.includes("meta_whatsapp_template_opt_ins") ? "grant"
          : sql.includes("INSERT INTO outbox") ? "outbox" : "other");
        return Promise.resolve({ rowCount: 1, rows: [{ id: "created" }] });
      });
      const tx = { query } as unknown as SqlExecutor;
      const db = { transaction: (work: (x: SqlExecutor) => Promise<unknown>) => work(tx) }
        as unknown as PostgresDatabase;
      const store = new PostgresWhatsAppConsentStore(db, Buffer.alloc(32, 21).toString("base64"));
      const inbound = new PostgresInboundStore(db, store);
      const event = eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE);
      await expect(inbound.ingest(event, metaIngressIdentity(event), "a".repeat(64)))
        .resolves.toBe("created");
      expect(calls).toEqual(["inbound", "grant", "outbox"]);
      const call = (query.mock.calls as Array<[string, unknown[]]>)
        .find(([sql]) => sql.includes("meta_whatsapp_template_opt_ins"));
      expect(call).toBeDefined();
      expect(call?.[0]).toContain("source_event_id=EXCLUDED.source_event_id");
      expect(call?.[0]).toContain("EXCLUDED.consented_at >");
      expect(call?.[1][0]).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(call?.[1])).not.toContain(RECIPIENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acknowledges only confirmed stored consent and does not consult generative AI", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const respond = vi.fn<BrainClient["respond"]>();
      const hasActiveConsent = vi.fn().mockResolvedValue(true);
      const handler = new MessageReceivedHandler({ respond }, undefined, { hasActiveConsent });
      const stored: StoredInboundEvent = {
        id: "11111111-1111-4111-8111-111111111111",
        partitionKey: "a".repeat(64), status: "persisted",
        event: eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE)
      };
      const result = await handler.handle(stored);
      expect(result.outcome).toBe("handled");
      expect(result.actions[0]?.body).toMatchObject({
        part: { kind: "text", text: WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION }
      });
      expect(hasActiveConsent).toHaveBeenCalledWith(ACCOUNT, RECIPIENT, "appointment_updates");
      expect(respond).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim consent when no consent store or grant exists", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const respond = vi.fn<BrainClient["respond"]>();
      const stored: StoredInboundEvent = {
        id: "11111111-1111-4111-8111-111111111111",
        partitionKey: "a".repeat(64), status: "persisted",
        event: eventFor(WHATSAPP_APPOINTMENT_OPT_IN_PHRASE)
      };
      const handler = new MessageReceivedHandler({ respond });
      const result = await handler.handle(stored);
      expect(result.actions[0]?.body).not.toMatchObject({
        part: { kind: "text", text: WHATSAPP_APPOINTMENT_OPT_IN_CONFIRMATION }
      });
      expect(respond).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
