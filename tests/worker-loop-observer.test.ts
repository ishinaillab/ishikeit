import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { ActionDispatcher } from "../src/dispatch/dispatcher.js";
import { InboundProcessorWorker } from "../src/workers/inbound-processor-worker.js";
import { OutboxWorker } from "../src/workers/outbox-worker.js";
import { EventHandlerRegistry } from "../src/processing/registry.js";
import type { OutboxDeliveryStore } from "../src/persistence/outbox.js";
import type { InboundEventProcessingStore } from "../src/persistence/inbound.js";
import type { WorkerLoopEvent } from "../src/observability/worker-loop-diagnostics.js";

function idleQueue(): OutboxDeliveryStore {
  return {
    claimNext: vi.fn<OutboxDeliveryStore["claimNext"]>().mockResolvedValue(undefined),
    complete: vi.fn<OutboxDeliveryStore["complete"]>().mockResolvedValue(true),
    retry: vi.fn<OutboxDeliveryStore["retry"]>().mockResolvedValue(true),
    deadLetter: vi.fn<OutboxDeliveryStore["deadLetter"]>().mockResolvedValue(true)
  };
}

describe("worker loop observation wiring", () => {
  it("receives actual inbound poll/start/stop events with an empty queue", async () => {
    const events: WorkerLoopEvent[] = [];
    const worker = new InboundProcessorWorker({
      queue: idleQueue(),
      events: {} as InboundEventProcessingStore,
      handlers: new EventHandlerRegistry(),
      logger: pino({ level: "silent" }),
      pollIntervalMs: 5,
      onLoopEvent: (event) => events.push(event)
    });
    try {
      worker.start();
      await vi.waitFor(() => expect(events).toContain("iteration_succeeded"), {
        timeout: 1_000
      });
    } finally {
      await worker.stop();
    }
    expect(events[0]).toBe("started");
    expect(events).toContain("iteration_started");
    expect(events.at(-1)).toBe("stopped");
  });

  it("does not crash outbound polling when the diagnostic sink throws", async () => {
    const events: WorkerLoopEvent[] = [];
    const worker = new OutboxWorker({
      store: idleQueue(),
      dispatcher: new ActionDispatcher(),
      logger: pino({ level: "silent" }),
      pollIntervalMs: 5,
      onLoopEvent: (event) => {
        events.push(event);
        throw new Error("diagnostic sink failed");
      }
    });
    try {
      worker.start();
      await vi.waitFor(() => expect(events).toContain("iteration_succeeded"), {
        timeout: 1_000
      });
    } finally {
      await worker.stop();
    }
    expect(events[0]).toBe("started");
    expect(events.at(-1)).toBe("stopped");
  });
});
