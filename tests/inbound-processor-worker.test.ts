import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { InboundEventProcessingStore, StoredInboundEvent } from "../src/persistence/inbound.js";
import type { OutboxDeliveryStore, OutboxJob } from "../src/persistence/outbox.js";
import { INBOUND_ACCEPTED_TOPIC } from "../src/persistence/outbox.js";
import { ProcessingFailure } from "../src/processing/failure.js";
import { EventHandlerRegistry } from "../src/processing/registry.js";
import { InboundProcessorWorker } from "../src/workers/inbound-processor-worker.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const job: OutboxJob = {
  id: "22222222-2222-4222-8222-222222222222",
  topic: INBOUND_ACCEPTED_TOPIC,
  partitionKey: "partition-1",
  payload: { schemaVersion: 1, eventId },
  attemptCount: 0,
  leaseToken: "33333333-3333-4333-8333-333333333333"
};

const stored: StoredInboundEvent = {
  id: eventId,
  partitionKey: "partition-1",
  status: "persisted",
  event: {
    schemaVersion: 2,
    specversion: "1.0",
    id: "evt-1",
    source: "urn:ishikeit:source:telegram:bot:bot-1",
    type: "com.ishikeit.messaging.message.received",
    provider: "telegram",
    channel: "bot",
    capability: "messaging",
    accountId: "bot-1",
    eventType: "message.received",
    identityId: "chat-1",
    receivedAt: "2026-09-30T00:00:00.000Z",
    content: [{ kind: "text", text: "hello" }],
    data: {}
  }
};

function makeQueue() {
  const claimNext = vi.fn<OutboxDeliveryStore["claimNext"]>().mockResolvedValue(job);
  const complete = vi.fn<OutboxDeliveryStore["complete"]>().mockResolvedValue(true);
  const retry = vi.fn<OutboxDeliveryStore["retry"]>().mockResolvedValue(true);
  const deadLetter = vi.fn<OutboxDeliveryStore["deadLetter"]>().mockResolvedValue(true);
  return {
    queue: { claimNext, complete, retry, deadLetter } satisfies OutboxDeliveryStore,
    claimNext, complete, retry, deadLetter
  };
}

function makeEvents() {
  const get = vi.fn<InboundEventProcessingStore["get"]>().mockResolvedValue(stored);
  const markProcessing = vi.fn<InboundEventProcessingStore["markProcessing"]>().mockResolvedValue();
  const complete = vi.fn<InboundEventProcessingStore["complete"]>().mockResolvedValue();
  const recordFailure = vi.fn<InboundEventProcessingStore["recordFailure"]>().mockResolvedValue();
  return {
    events: { get, markProcessing, complete, recordFailure } satisfies InboundEventProcessingStore,
    get, markProcessing, complete, recordFailure
  };
}

describe("InboundProcessorWorker", () => {
  it("processes a claimed event and durably completes its generated actions", async () => {
    const q = makeQueue();
    const e = makeEvents();
    const handlers = new EventHandlerRegistry();
    handlers.register({
      canHandle: () => true,
      handle: vi.fn().mockResolvedValue([{
        schemaVersion: 1,
        idempotencyKey: eventId + ":reply:0",
        provider: "telegram",
        capability: "messaging",
        operation: "message.send",
        orderingKey: "partition-1",
        target: { recipientId: "chat-1" },
        body: { part: { kind: "text", text: "Hi" } }
      }])
    });
    const worker = new InboundProcessorWorker({
      queue: q.queue,
      events: e.events,
      handlers,
      logger: pino({ level: "silent" })
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(q.claimNext).toHaveBeenCalledWith(INBOUND_ACCEPTED_TOPIC, 120000);
    expect(e.markProcessing).toHaveBeenCalledWith(eventId);
    expect(e.complete).toHaveBeenCalledWith(eventId, expect.arrayContaining([
      expect.objectContaining({ provider: "telegram", operation: "message.send" })
    ]));
    expect(q.complete).toHaveBeenCalledWith(job);
  });

  it("marks unsupported event types processed without invoking an adapter", async () => {
    const q = makeQueue();
    const e = makeEvents();
    e.get.mockResolvedValue({
      ...stored,
      event: { ...stored.event, eventType: "delivery.read" }
    });
    const handlers = new EventHandlerRegistry();
    const worker = new InboundProcessorWorker({
      queue: q.queue,
      events: e.events,
      handlers,
      logger: pino({ level: "silent" })
    });

    await worker.runOnce();
    expect(e.complete).toHaveBeenCalledWith(eventId, []);
    expect(q.complete).toHaveBeenCalledWith(job);
  });

  it("retries transient processing failures without losing the source event", async () => {
    const q = makeQueue();
    const e = makeEvents();
    const handlers = new EventHandlerRegistry();
    handlers.register({
      canHandle: () => true,
      handle: vi.fn().mockRejectedValue(new ProcessingFailure("AI temporarily unavailable", { retryable: true }))
    });
    const worker = new InboundProcessorWorker({
      queue: q.queue,
      events: e.events,
      handlers,
      logger: pino({ level: "silent" }),
      baseBackoffMs: 1000,
      now: () => new Date("2026-09-30T00:00:00.000Z")
    });

    await worker.runOnce();
    expect(e.recordFailure).toHaveBeenCalledWith(eventId, "AI temporarily unavailable");
    expect(q.retry).toHaveBeenCalledWith(job, new Date("2026-09-30T00:00:01.000Z"));
    expect(q.deadLetter).not.toHaveBeenCalled();
  });
});
