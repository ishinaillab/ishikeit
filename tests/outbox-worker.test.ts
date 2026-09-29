import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { MetaSendFailure, type MetaMessageSender } from "../src/channels/meta-send.js";
import type { OutboxDeliveryStore, OutboxJob } from "../src/persistence/outbox.js";
import { OutboxWorker } from "../src/workers/outbox-worker.js";

const job: OutboxJob = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: "meta.message.send",
  partitionKey: "partition-1",
  payload: {
    schemaVersion: 1,
    channel: "instagram",
    accountId: "ig-1",
    recipientId: "user-1",
    message: { type: "text", text: "hello" }
  },
  attemptCount: 0,
  leaseToken: "22222222-2222-4222-8222-222222222222"
};

function makeStore(claimed: OutboxJob | undefined = job): OutboxDeliveryStore {
  return {
    claimNext: vi.fn<OutboxDeliveryStore["claimNext"]>().mockResolvedValue(claimed),
    complete: vi.fn<OutboxDeliveryStore["complete"]>().mockResolvedValue(true),
    retry: vi.fn<OutboxDeliveryStore["retry"]>().mockResolvedValue(true),
    deadLetter: vi.fn<OutboxDeliveryStore["deadLetter"]>().mockResolvedValue(true)
  };
}

function makeSender(): MetaMessageSender {
  return {
    send: vi.fn<MetaMessageSender["send"]>().mockResolvedValue({ providerMessageId: "provider-1" })
  };
}

describe("OutboxWorker", () => {
  it("returns idle without a claim", async () => {
    const worker = new OutboxWorker({
      store: makeStore(undefined),
      sender: makeSender(),
      logger: pino({ level: "silent" })
    });

    await expect(worker.runOnce()).resolves.toBe(false);
  });

  it("publishes a valid leased message", async () => {
    const store = makeStore();
    const sender = makeSender();
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenCalledWith(job, "provider-1");
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters an invalid outbound payload without sending", async () => {
    const invalid = { ...job, payload: { channel: "instagram" } };
    const store = makeStore(invalid);
    const sender = makeSender();
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await worker.runOnce();
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.deadLetter).toHaveBeenCalledWith(invalid, "invalid meta.message.send payload");
  });

  it("schedules retryable failures with exponential backoff", async () => {
    const store = makeStore();
    const sender: MetaMessageSender = {
      send: vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
        new MetaSendFailure("rate limited", { retryable: true, status: 429 })
      )
    };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" }),
      baseBackoffMs: 1000,
      now: () => new Date("2026-09-30T00:00:00.000Z")
    });

    await worker.runOnce();
    expect(store.retry).toHaveBeenCalledWith(job, new Date("2026-09-30T00:00:01.000Z"));
    expect(store.deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters permanent failures immediately", async () => {
    const store = makeStore();
    const sender: MetaMessageSender = {
      send: vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
        new MetaSendFailure("invalid recipient", { retryable: false, status: 400, graphCode: 100 })
      )
    };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await worker.runOnce();
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.deadLetter).toHaveBeenCalledTimes(1);
  });

  it("dead-letters retryable failures after the bounded attempt limit", async () => {
    const exhausted = { ...job, attemptCount: 4 };
    const store = makeStore(exhausted);
    const sender: MetaMessageSender = {
      send: vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
        new MetaSendFailure("temporary failure", { retryable: true, status: 503 })
      )
    };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" }),
      maxAttempts: 5
    });

    await worker.runOnce();
    expect(store.retry).not.toHaveBeenCalled();
    expect(store.deadLetter).toHaveBeenCalledTimes(1);
  });
});
