import type { Logger } from "pino";
import { z } from "zod";
import type { InboundEventProcessingStore } from "../persistence/inbound.js";
import { INBOUND_ACCEPTED_TOPIC, type OutboxDeliveryStore, type OutboxJob } from "../persistence/outbox.js";
import { ProcessingFailure } from "../processing/failure.js";
import type { EventHandlerRegistry } from "../processing/registry.js";

const acceptedPayloadSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  eventId: z.string().uuid()
}).passthrough();

export interface InboundProcessorWorkerOptions {
  queue: OutboxDeliveryStore;
  events: InboundEventProcessingStore;
  handlers: EventHandlerRegistry;
  logger: Logger;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  processorCutoverAt?: Date;
  canaryPartitionKeys?: readonly string[];
  now?: () => Date;
}

export class InboundProcessorWorker {
  readonly #queue: OutboxDeliveryStore;
  readonly #events: InboundEventProcessingStore;
  readonly #handlers: EventHandlerRegistry;
  readonly #logger: Logger;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #maxAttempts: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #processorCutoverAt: Date | undefined;
  readonly #canaryPartitionKeys: ReadonlySet<string>;
  readonly #now: () => Date;
  #stopping = false;
  #loop: Promise<void> | undefined;

  constructor(options: InboundProcessorWorkerOptions) {
    this.#queue = options.queue;
    this.#events = options.events;
    this.#handlers = options.handlers;
    this.#logger = options.logger;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#leaseDurationMs = options.leaseDurationMs ?? 120_000;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#baseBackoffMs = options.baseBackoffMs ?? 2000;
    this.#maxBackoffMs = options.maxBackoffMs ?? 300_000;
    this.#processorCutoverAt = options.processorCutoverAt;
    this.#canaryPartitionKeys = new Set(options.canaryPartitionKeys ?? []);
    this.#now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.#loop !== undefined) return;
    this.#stopping = false;
    this.#loop = this.#runLoop();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    await this.#loop;
    this.#loop = undefined;
  }

  async runOnce(): Promise<boolean> {
    const job = await this.#queue.claimNext(INBOUND_ACCEPTED_TOPIC, this.#leaseDurationMs);
    if (job === undefined) return false;

    const accepted = acceptedPayloadSchema.safeParse(job.payload);
    if (!accepted.success) {
      await this.#queue.deadLetter(job, "invalid inbound.event.accepted payload");
      this.#logger.error({ outboxId: job.id }, "dead-lettered invalid inbound queue payload");
      return true;
    }

    const stored = await this.#events.get(accepted.data.eventId).catch((error: unknown) => {
      throw new ProcessingFailure("failed to load inbound event", { retryable: true, cause: error });
    });

    if (stored === undefined) {
      await this.#queue.deadLetter(job, "inbound event no longer exists");
      this.#logger.error({ outboxId: job.id, eventId: accepted.data.eventId }, "dead-lettered orphaned inbound job");
      return true;
    }

    if (stored.processedAt !== undefined || stored.status === "processed") {
      await this.#queue.complete(job);
      return true;
    }

    const skipReason = this.#rolloutSkipReason(stored);
    if (skipReason !== undefined) {
      await this.#events.complete(stored.id, []);
      const completed = await this.#queue.complete(job);
      if (!completed) {
        this.#logger.warn({ outboxId: job.id, eventId: stored.id, skipReason }, "rollout skip lost its queue lease");
      } else {
        this.#logger.info({
          outboxId: job.id,
          eventId: stored.id,
          provider: stored.event.provider,
          channel: stored.event.channel,
          eventType: stored.event.eventType,
          skipReason
        }, "inbound event skipped by rollout guard");
      }
      return true;
    }

    await this.#events.markProcessing(stored.id);

    try {
      const actions = await this.#handlers.handle(stored);
      await this.#events.complete(stored.id, actions);
      const completed = await this.#queue.complete(job);
      if (!completed) {
        this.#logger.warn({ outboxId: job.id, eventId: stored.id }, "inbound completion lost its lease");
      } else {
        this.#logger.info({
          outboxId: job.id,
          eventId: stored.id,
          provider: stored.event.provider,
          channel: stored.event.channel,
          eventType: stored.event.eventType,
          actionCount: actions.length
        }, "inbound event processed");
      }
      return true;
    } catch (error) {
      await this.#handleFailure(job, stored.id, error);
      return true;
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        const worked = await this.runOnce();
        if (!worked) await this.#sleep(this.#pollIntervalMs);
      } catch (error) {
        this.#logger.error({ err: error }, "inbound processor iteration failed");
        await this.#sleep(this.#pollIntervalMs);
      }
    }
  }

  async #handleFailure(job: OutboxJob, eventId: string, error: unknown): Promise<void> {
    const failure = error instanceof ProcessingFailure
      ? error
      : new ProcessingFailure("unexpected inbound processing failure", { retryable: true, cause: error });
    const nextAttemptNumber = job.attemptCount + 1;
    const reason = failure.message;

    await this.#events.recordFailure(eventId, reason);

    if (!failure.retryable || nextAttemptNumber >= this.#maxAttempts) {
      await this.#queue.deadLetter(job, reason);
      this.#logger.error({
        outboxId: job.id,
        eventId,
        retryable: failure.retryable,
        attempt: nextAttemptNumber
      }, "inbound event dead-lettered");
      return;
    }

    const delayMs = this.#backoffMs(nextAttemptNumber, failure.retryAfterMs);
    const nextAttemptAt = new Date(this.#now().getTime() + delayMs);
    await this.#queue.retry(job, nextAttemptAt);
    this.#logger.warn({
      outboxId: job.id,
      eventId,
      attempt: nextAttemptNumber,
      nextAttemptAt: nextAttemptAt.toISOString()
    }, "inbound event scheduled for retry");
  }

  #rolloutSkipReason(stored: Awaited<ReturnType<InboundEventProcessingStore["get"]>> & {}): string | undefined {
    if (
      this.#processorCutoverAt !== undefined
      && new Date(stored.event.receivedAt).getTime() < this.#processorCutoverAt.getTime()
    ) {
      return "before_processor_cutover";
    }

    if (
      this.#canaryPartitionKeys.size > 0
      && !this.#canaryPartitionKeys.has(stored.partitionKey)
    ) {
      return "outside_canary_partitions";
    }

    return undefined;
  }

  #backoffMs(attempt: number, retryAfter: number | undefined): number {
    const exponential = Math.min(this.#maxBackoffMs, this.#baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
    return Math.min(this.#maxBackoffMs, Math.max(exponential, retryAfter ?? 0));
  }

  async #sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
