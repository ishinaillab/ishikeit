import type { Logger } from "pino";
import { actionEnvelopeSchema } from "../domain/actions.js";
import type { ActionDispatcher } from "../dispatch/dispatcher.js";
import { DispatchFailure } from "../dispatch/failure.js";
import { ACTION_DISPATCH_TOPIC, type OutboxDeliveryStore, type OutboxJob } from "../persistence/outbox.js";

export interface OutboxWorkerOptions {
  store: OutboxDeliveryStore;
  dispatcher: ActionDispatcher;
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
  readonly #dispatcher: ActionDispatcher;
  readonly #logger: Logger;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #maxAttempts: number;
  readonly #baseBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #now: () => Date;
  #stopping = false;
  #loop: Promise<void> | undefined;

  constructor(options: OutboxWorkerOptions) {
    this.#store = options.store;
    this.#dispatcher = options.dispatcher;
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
    const job = await this.#store.claimNext(ACTION_DISPATCH_TOPIC, this.#leaseDurationMs);
    if (job === undefined) return false;

    const parsed = actionEnvelopeSchema.safeParse(job.payload);
    if (!parsed.success) {
      await this.#store.deadLetter(job, "invalid action.dispatch payload");
      this.#logger.error({ outboxId: job.id }, "dead-lettered invalid action payload");
      return true;
    }

    try {
      const result = await this.#dispatcher.dispatch(parsed.data);
      const completed = await this.#store.complete(job, result.providerResourceId);
      if (!completed) {
        this.#logger.warn({ outboxId: job.id }, "action completion lost its lease");
      } else {
        this.#logger.info({
          outboxId: job.id,
          provider: parsed.data.provider,
          capability: parsed.data.capability,
          operation: parsed.data.operation,
          providerResourceId: result.providerResourceId
        }, "outbound action published");
      }
      return true;
    } catch (error) {
      await this.#handleFailure(job, error, parsed.data.provider, parsed.data.capability, parsed.data.operation);
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

  async #handleFailure(
    job: OutboxJob,
    error: unknown,
    provider: string,
    capability: string,
    operation: string
  ): Promise<void> {
    const failure = error instanceof DispatchFailure
      ? error
      : new DispatchFailure("unexpected outbound dispatch failure", {
          retryable: true,
          ambiguous: true,
          cause: error
        });
    const nextAttemptNumber = job.attemptCount + 1;

    if (!failure.retryable || nextAttemptNumber >= this.#maxAttempts) {
      await this.#store.deadLetter(job, this.#failureReason(failure));
      this.#logger.error({
        outboxId: job.id,
        provider,
        capability,
        operation,
        retryable: failure.retryable,
        ambiguous: failure.ambiguous,
        status: failure.status,
        providerCode: failure.providerCode,
        attempt: nextAttemptNumber
      }, "outbound action dead-lettered");
      return;
    }

    const delayMs = this.#backoffMs(nextAttemptNumber, failure.retryAfterMs);
    const nextAttemptAt = new Date(this.#now().getTime() + delayMs);
    await this.#store.retry(job, nextAttemptAt);
    this.#logger.warn({
      outboxId: job.id,
      provider,
      capability,
      operation,
      ambiguous: failure.ambiguous,
      status: failure.status,
      providerCode: failure.providerCode,
      attempt: nextAttemptNumber,
      nextAttemptAt: nextAttemptAt.toISOString()
    }, "outbound action scheduled for retry");
  }

  #backoffMs(attempt: number, retryAfter: number | undefined): number {
    const exponential = Math.min(this.#maxBackoffMs, this.#baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
    return Math.min(this.#maxBackoffMs, Math.max(exponential, retryAfter ?? 0));
  }

  #failureReason(failure: DispatchFailure): string {
    return [
      failure.message,
      failure.status === undefined ? undefined : `http=${failure.status}`,
      failure.providerCode === undefined ? undefined : `provider_code=${failure.providerCode}`,
      failure.ambiguous ? "delivery_ambiguous=true" : undefined
    ].filter((value): value is string => value !== undefined).join("; ");
  }

  async #sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
