import type { Logger } from "pino";
import { MetaSendFailure, type MetaMessageSender } from "../channels/meta-send.js";
import { metaOutboundPayloadSchema } from "../domain/outbound.js";
import type { OutboxDeliveryStore, OutboxJob } from "../persistence/outbox.js";

export interface OutboxWorkerOptions {
  store: OutboxDeliveryStore;
  sender: MetaMessageSender;
  logger: Logger;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => Date;
}

export class OutboxWorker {
  readonly #store: OutboxDeliveryStore;
  readonly #sender: MetaMessageSender;
  readonly #logger: Logger;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #maxAttempts: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #now: () => Date;
  #stopping = false;
  #loop?: Promise<void>;

  constructor(options: OutboxWorkerOptions) {
    this.#store = options.store;
    this.#sender = options.sender;
    this.#logger = options.logger;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.#maxBackoffMs = options.maxBackoffMs ?? 300_000;
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
    const job = await this.#store.claimNext(this.#leaseDurationMs);
    if (job === undefined) return false;

    const parsed = metaOutboundPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await this.#store.deadLetter(job, "invalid meta.message.send payload");
      this.#logger.error({ outboxId: job.id }, "dead-lettered invalid outbound payload");
      return true;
    }

    try {
      const result = await this.#sender.send(parsed.data);
      const completed = await this.#store.complete(job, result.providerMessageId);
      if (!completed) {
        this.#logger.warn({ outboxId: job.id }, "outbound completion lost its lease");
      } else {
        this.#logger.info({
          outboxId: job.id,
          channel: parsed.data.channel,
          accountId: parsed.data.accountId,
          providerMessageId: result.providerMessageId
        }, "Meta outbound message published");
      }
      return true;
    } catch (error) {
      await this.#handleFailure(job, error, parsed.data.channel);
      return true;
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        const worked = await this.runOnce();
        if (!worked) await this.#sleep(this.#pollIntervalMs);
      } catch (error) {
        this.#logger.error({ err: error }, "outbound worker iteration failed");
        await this.#sleep(this.#pollIntervalMs);
      }
    }
  }

  async #handleFailure(job: OutboxJob, error: unknown, channel: string): Promise<void> {
    const failure = error instanceof MetaSendFailure
      ? error
      : new MetaSendFailure("unexpected outbound worker failure", {
          retryable: true,
          ambiguous: true,
          cause: error
        });
    const nextAttemptNumber = job.attemptCount + 1;

    if (!failure.retryable || nextAttemptNumber >= this.#maxAttempts) {
      const reason = this.#failureReason(failure);
      await this.#store.deadLetter(job, reason);
      this.#logger.error({
        outboxId: job.id,
        channel,
        retryable: failure.retryable,
        ambiguous: failure.ambiguous,
        status: failure.status,
        graphCode: failure.graphCode,
        graphSubcode: failure.graphSubcode,
        attempt: nextAttemptNumber
      }, "Meta outbound message dead-lettered");
      return;
    }

    const delayMs = this.#backoffMs(nextAttemptNumber, failure.retryAfterMs);
    const nextAttemptAt = new Date(this.#now().getTime() + delayMs);
    await this.#store.retry(job, nextAttemptAt);
    this.#logger.warn({
      outboxId: job.id,
      channel,
      ambiguous: failure.ambiguous,
      status: failure.status,
      graphCode: failure.graphCode,
      graphSubcode: failure.graphSubcode,
      attempt: nextAttemptNumber,
      nextAttemptAt: nextAttemptAt.toISOString()
    }, "Meta outbound message scheduled for retry");
  }

  #backoffMs(attempt: number, retryAfterMs: number | undefined): number {
    const exponential = Math.min(this.#maxBackoffMs, this.#baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
    return Math.min(this.#maxBackoffMs, Math.max(exponential, retryAfterMs ?? 0));
  }

  #failureReason(failure: MetaSendFailure): string {
    const parts = [
      failure.message,
      failure.status === undefined ? undefined : `http=${failure.status}`,
      failure.graphCode === undefined ? undefined : `graph_code=${failure.graphCode}`,
      failure.graphSubcode === undefined ? undefined : `graph_subcode=${failure.graphSubcode}`,
      failure.ambiguous ? "delivery_ambiguous=true" : undefined
    ].filter((value): value is string => value !== undefined);
    return parts.join("; ");
  }

  async #sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
