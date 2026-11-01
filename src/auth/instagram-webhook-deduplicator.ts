/** A process-local account-scoped gate for startup webhook subscription readbacks.
 *
 * OAuth and the legacy managed token may resolve to the exact same Instagram
 * Professional account. The first successful reconciliation covers that
 * account's fields; a second immediate Graph call on another token is redundant
 * and can trigger provider throttling (Graph 613). Never conflate distinct IDs.
 *
 * A failed provider call never marks the account verified. In-flight work is
 * joined so two startup operations cannot race a duplicate call.
 */
export class InstagramWebhookSubscriptionDeduplicator {
  readonly #verified = new Set<string>();
  readonly #inFlight = new Map<string, Promise<void>>();

  async ensure(
    professionalAccountId: string,
    reconcile: () => Promise<void>
  ): Promise<"reconciled" | "reused"> {
    if (professionalAccountId.length === 0) throw new Error("Missing Instagram Professional account ID");
    if (this.#verified.has(professionalAccountId)) return "reused";
    const inFlight = this.#inFlight.get(professionalAccountId);
    if (inFlight !== undefined) {
      await inFlight;
      return "reused";
    }
    const work = Promise.resolve().then(reconcile);
    this.#inFlight.set(professionalAccountId, work);
    try {
      await work;
      this.#verified.add(professionalAccountId);
      return "reconciled";
    } finally {
      this.#inFlight.delete(professionalAccountId);
    }
  }
}
