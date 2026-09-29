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

function makeStore(claimed: OutboxJob | undefined = job) {
  const claimNext = vi.fn<OutboxDeliveryStore["claimNext"]>().mockResolvedValue(claimed);
  const complete = vi.fn<OutboxDeliveryStore["complete"]>().mockResolvedValue(true);
  const retry = vi.fn<OutboxDeliveryStore["retry"]>().mockResolvedValue(true);
  const deadLetter = vi.fn<OutboxDeliveryStore["deadLetter"]>().mockResolvedValue(true);
  const store: OutboxDeliveryStore = { claimNext, complete, retry, deadLetter };
  return { store, claimNext, complete, retry, deadLetter };
}

function makeSender() {
  const send = vi.fn<MetaMessageSender["send"]>().mockResolvedValue({ providerMessageId: "provider-1" });
  const sender: MetaMessageSender = { send };
  return { sender, send };
}

describe("OutboxWorker", () => {
  it("returns idle without a claim", async () => {
    const { store } = makeStore(undefined);
    const { sender } = makeSender();
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await expect(worker.runOnce()).resolves.toBe(false);
  });

  it("publishes a valid leased message", async () => {
    const { store, complete, retry, deadLetter } = makeStore();
    const { sender, send } = makeSender();
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(job, "provider-1");
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters an invalid outbound payload without sending", async () => {
    const invalid = { ...job, payload: { channel: "instagram" } };
    const { store, deadLetter } = makeStore(invalid);
    const { sender, send } = makeSender();
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await worker.runOnce();
    expect(send).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledWith(invalid, "invalid meta.message.send payload");
  });

  it("schedules retryable failures with exponential backoff", async () => {
    const { store, retry, deadLetter } = makeStore();
    const send = vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
      new MetaSendFailure("rate limited", { retryable: true, status: 429 })
    );
    const sender: MetaMessageSender = { send };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" }),
      baseBackoffMs: 1000,
      now: () => new Date("2026-09-30T00:00:00.000Z")
    });

    await worker.runOnce();
    expect(retry).toHaveBeenCalledWith(job, new Date("2026-09-30T00:00:01.000Z"));
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters permanent failures immediately", async () => {
    const { store, retry, deadLetter } = makeStore();
    const send = vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
      new MetaSendFailure("invalid recipient", { retryable: false, status: 400, graphCode: 100 })
    );
    const sender: MetaMessageSender = { send };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" })
    });

    await worker.runOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledTimes(1);
  });

  it("dead-letters retryable failures after the bounded attempt limit", async () => {
    const exhausted = { ...job, attemptCount: 4 };
    const { store, retry, deadLetter } = makeStore(exhausted);
    const send = vi.fn<MetaMessageSender["send"]>().mockRejectedValue(
      new MetaSendFailure("temporary failure", { retryable: true, status: 503 })
    );
    const sender: MetaMessageSender = { send };
    const worker = new OutboxWorker({
      store,
      sender,
      logger: pino({ level: "silent" }),
      maxAttempts: 5
    });

    await worker.runOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledTimes(1);
  });
});
