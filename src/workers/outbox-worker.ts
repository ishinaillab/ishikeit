import type { Logger } from "pino";
import type { WorkerLoopEvent } from "../observability/worker-loop-diagnostics.js";
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
  onLoopEvent?: (event: WorkerLoopEvent) => void;
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
  readonly #onLoopEvent: ((event: WorkerLoopEvent) => void) | undefined;
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
    this.#onLoopEvent = options.onLoopEvent;
  }

  start(): void {
    if (this.#loop !== undefined) return;
    this.#stopping = false;
    this.#emitLoopEvent("started");
    this.#loop = this.#runLoop();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    await this.#loop;
    this.#loop = undefined;
    this.#emitLoopEvent("stopped");
  }

  async runOnce(): Promise<boolean> {
    const job = await this.#store.claimNext(ACTION_DISPATCH_TOPIC, this.#leaseDurationMs);
    if (job === undefined) return false;

    const attemptStartedAt = performance.now();
    const parsed = actionEnvelopeSchema.safeParse(job.payload);
    if (!parsed.success) {
      await this.#store.deadLetter(job, "invalid action.dispatch payload");
      this.#logger.error({ outboxId: job.id }, "dead-lettered invalid action payload");
      return true;
    }

    try {
      const metaMessageSend = parsed.data.provider === "meta"
        && parsed.data.capability === "messaging"
        && (parsed.data.operation === "message.send" || parsed.data.operation === "message.template.send");
      const telegramMessageSend = parsed.data.provider === "telegram"
        && parsed.data.capability === "messaging" && parsed.data.operation === "message.send";
      if (metaMessageSend || telegramMessageSend) {
        // Non-idempotent providers: arm durably before making the POST.
        // A lost response or crashed worker must never trigger a second send.
        const arm = telegramMessageSend
          ? this.#store.prepareTelegramSend?.bind(this.#store)
          : this.#store.prepareMetaSend?.bind(this.#store);
        if (arm === undefined) {
          throw new DispatchFailure("Durable provider send fence unavailable", { retryable: false });
        }
        if (!await arm(job)) {
          this.#logger.warn({ outboxId: job.id }, "Provider send fence not acquired; no provider call made");
          return true;
        }
      }
      const result = await this.#dispatcher.dispatch(parsed.data);
      const completed = await this.#store.complete(job, result.providerResourceId, {
        provider: parsed.data.provider,
        capability: parsed.data.capability,
        operation: parsed.data.operation,
        durationMs: performance.now() - attemptStartedAt
      });
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
      await this.#handleFailure(
        job,
        error,
        parsed.data.provider,
        parsed.data.capability,
        parsed.data.operation,
        performance.now() - attemptStartedAt
      );
      return true;
    }
  }

  #emitLoopEvent(event: WorkerLoopEvent): void {
    try {
      this.#onLoopEvent?.(event);
    } catch {
      // Diagnostics must never interrupt message processing or shutdown.
    }
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      this.#emitLoopEvent("iteration_started");
      try {
        const worked = await this.runOnce();
        this.#emitLoopEvent("iteration_succeeded");
        if (!worked) await this.#sleep(this.#pollIntervalMs);
      } catch (error) {
        this.#emitLoopEvent("iteration_failed");
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
    operation: string,
    durationMs: number
  ): Promise<void> {
    const failure = error instanceof DispatchFailure
      ? error
      : new DispatchFailure("unexpected outbound dispatch failure", {
          retryable: true,
          ambiguous: true,
          cause: error
        });
    const nextAttemptNumber = job.attemptCount + 1;
    // Meta Send API POSTs have no demonstrated provider-side idempotency key.
    // A lost HTTP response may follow a successful provider send. Preserve the
    // outcome for manual reconciliation instead of repeating the same POST.
    const metaMessageSend = provider === "meta"
      && capability === "messaging"
      && (operation === "message.send" || operation === "message.template.send");
    // Retry a Meta POST only after an explicit, unambiguous 429 rejection.
    // HTTP 5xx and other retryable provider errors may not conclusively rule
    // out acceptance, so they must not repeat the POST automatically.
    const definitelyRejectedThrottle = failure.status === 429 && !failure.ambiguous;
    const telegramMessageSend = provider === "telegram"
      && capability === "messaging" && operation === "message.send";
    const unknownProviderOutcome = (metaMessageSend || telegramMessageSend)
      && (failure.ambiguous || (failure.retryable && !definitelyRejectedThrottle));

    if (unknownProviderOutcome || !failure.retryable || nextAttemptNumber >= this.#maxAttempts) {
      const reason = unknownProviderOutcome
        ? `provider_outcome_unknown; manual_reconciliation_required=true; ${this.#failureReason(failure)}`
        : this.#failureReason(failure);
      await this.#store.deadLetter(job, reason, {
        provider,
        capability,
        operation,
        durationMs,
        retryable: failure.retryable,
        ambiguous: failure.ambiguous,
        ...(failure.status === undefined ? {} : { httpStatus: failure.status }),
        ...(failure.providerCode === undefined ? {} : { providerCode: failure.providerCode }),
        errorClass: unknownProviderOutcome ? "provider_outcome_unknown" : this.#errorClass(failure)
      });
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
      }, unknownProviderOutcome
        ? "Provider outbound outcome unknown; quarantined for manual reconciliation without automatic retry"
        : "outbound action dead-lettered");
      return;
    }

    const delayMs = this.#backoffMs(nextAttemptNumber, failure.retryAfterMs);
    const nextAttemptAt = new Date(this.#now().getTime() + delayMs);
    await this.#store.retry(job, nextAttemptAt, {
      provider,
      capability,
      operation,
      durationMs,
      retryable: failure.retryable,
      ambiguous: failure.ambiguous,
      ...(failure.status === undefined ? {} : { httpStatus: failure.status }),
      ...(failure.providerCode === undefined ? {} : { providerCode: failure.providerCode }),
      errorClass: this.#errorClass(failure)
    });
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

  #errorClass(failure: DispatchFailure): string {
    if (failure.status === 429) return "throttled";
    if (failure.status === 401 || failure.status === 403) return "authorization";
    if (failure.status !== undefined && failure.status >= 500) return "provider_server";
    if (failure.status !== undefined && failure.status >= 400) return "provider_client";
    if (failure.ambiguous) return "transport_ambiguous";
    return failure.retryable ? "transient" : "permanent";
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
