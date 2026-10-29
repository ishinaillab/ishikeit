import type { Logger } from "pino";
import type { LatePointReminderPlanStore } from "../persistence/latepoint-reminder-plans.js";

/**
 * Durable deadline reconciliation without any outbound actions.
 * The clock suppresses expired slots rather than performing catch-up sends.
 * A second tick cannot overlap an in-flight database write.
 */
export class LatePointReminderClock {
  #timer: NodeJS.Timeout | undefined;
  #inFlight: Promise<void> | undefined;

  constructor(
    private readonly store: Pick<LatePointReminderPlanStore, "suppressDue">,
    private readonly logger: Logger,
    private readonly intervalMs = 60_000
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
      throw new Error("Invalid reminder reconciliation interval");
    }
  }

  runOnce(now: Date = new Date()): Promise<number> {
    return this.store.suppressDue(now);
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#poll();
    this.#timer = setInterval(() => this.#poll(), this.intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#inFlight;
  }

  #poll(): void {
    if (this.#inFlight !== undefined) return;
    this.#inFlight = this.runOnce()
      .then(count => {
        if (count > 0) {
          this.logger.info({ count }, "expired LatePoint reminder deadlines suppressed without sending");
        }
      })
      .catch(() => {
        this.logger.warn("non-sending LatePoint deadline reconciliation failed");
      })
      .finally(() => { this.#inFlight = undefined; });
  }
}
