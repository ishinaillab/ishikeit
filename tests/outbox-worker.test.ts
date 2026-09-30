import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { ActionDispatcher, type ActionAdapter } from "../src/dispatch/dispatcher.js";
import { DispatchFailure } from "../src/dispatch/failure.js";
import type { OutboxDeliveryStore, OutboxJob } from "../src/persistence/outbox.js";
import { ACTION_DISPATCH_TOPIC } from "../src/persistence/outbox.js";
import { OutboxWorker } from "../src/workers/outbox-worker.js";

const job: OutboxJob = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: ACTION_DISPATCH_TOPIC,
  partitionKey: "partition-1",
  payload: {
    schemaVersion: 1,
    idempotencyKey: "reply:event-1",
    provider: "telegram",
    capability: "messaging",
    operation: "message.send",
    orderingKey: "partition-1",
    target: { channel: "bot", accountId: "bot-1", recipientId: "chat-1" },
    body: { part: { kind: "text", text: "hello" } }
  },
  attemptCount: 0,
  leaseToken: "22222222-2222-4222-8222-222222222222"
};

function makeStore(claimed: OutboxJob | undefined) {
  const claimNext = vi.fn<OutboxDeliveryStore["claimNext"]>().mockResolvedValue(claimed);
  const complete = vi.fn<OutboxDeliveryStore["complete"]>().mockResolvedValue(true);
  const retry = vi.fn<OutboxDeliveryStore["retry"]>().mockResolvedValue(true);
  const deadLetter = vi.fn<OutboxDeliveryStore["deadLetter"]>().mockResolvedValue(true);
  const store: OutboxDeliveryStore = { claimNext, complete, retry, deadLetter };
  return { store, claimNext, complete, retry, deadLetter };
}

function makeDispatcher(
  execute = vi.fn<ActionAdapter["execute"]>().mockResolvedValue({ providerResourceId: "provider-1" })
) {
  const dispatcher = new ActionDispatcher();
  dispatcher.register({
    provider: "telegram",
    capability: "messaging",
    operation: "message.send",
    execute
  });
  return { dispatcher, execute };
}

describe("OutboxWorker", () => {
  it("returns idle without a claim", async () => {
    const { store, claimNext } = makeStore(undefined);
    const { dispatcher } = makeDispatcher();
    const worker = new OutboxWorker({ store, dispatcher, logger: pino({ level: "silent" }) });
    await expect(worker.runOnce()).resolves.toBe(false);
    expect(claimNext).toHaveBeenCalledWith(ACTION_DISPATCH_TOPIC, 30000);
  });

  it("publishes a valid generic action", async () => {
    const { store, complete, retry, deadLetter } = makeStore(job);
    const { dispatcher, execute } = makeDispatcher();
    const worker = new OutboxWorker({ store, dispatcher, logger: pino({ level: "silent" }) });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(job, "provider-1", expect.objectContaining({
      provider: "telegram",
      capability: "messaging",
      operation: "message.send"
    }));
    expect(typeof complete.mock.calls[0]?.[2]?.durationMs).toBe("number");
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters invalid generic action payloads", async () => {
    const invalid = { ...job, payload: { provider: "telegram" } };
    const { store, deadLetter } = makeStore(invalid);
    const { dispatcher, execute } = makeDispatcher();
    const worker = new OutboxWorker({ store, dispatcher, logger: pino({ level: "silent" }) });

    await worker.runOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledWith(invalid, "invalid action.dispatch payload");
  });

  it("schedules retryable adapter failures with backoff", async () => {
    const { store, retry, deadLetter } = makeStore(job);
    const execute = vi.fn<ActionAdapter["execute"]>().mockRejectedValue(
      new DispatchFailure("rate limited", { retryable: true, status: 429 })
    );
    const { dispatcher } = makeDispatcher(execute);
    const worker = new OutboxWorker({
      store,
      dispatcher,
      logger: pino({ level: "silent" }),
      baseBackoffMs: 1000,
      now: () => new Date("2026-09-30T00:00:00.000Z")
    });

    await worker.runOnce();
    expect(retry).toHaveBeenCalledWith(
      job,
      new Date("2026-09-30T00:00:01.000Z"),
      expect.objectContaining({
        provider: "telegram",
        capability: "messaging",
        operation: "message.send",
        retryable: true,
        errorClass: "throttled",
        httpStatus: 429
      })
    );
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it("dead-letters permanent adapter failures immediately", async () => {
    const { store, retry, deadLetter } = makeStore(job);
    const execute = vi.fn<ActionAdapter["execute"]>().mockRejectedValue(
      new DispatchFailure("unsupported", { retryable: false, status: 400 })
    );
    const { dispatcher } = makeDispatcher(execute);
    const worker = new OutboxWorker({ store, dispatcher, logger: pino({ level: "silent" }) });

    await worker.runOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledTimes(1);
  });
});
