import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { EventHandler } from "./registry.js";
import type { EventHandlingResult } from "../domain/processing.js";
import type { MetaRoutingControl } from "../persistence/meta-handoff.js";

/**
 * Translates only signed, normalized Meta routing callbacks into durable
 * ownership suppression. Never infer ownership from a normal customer message.
 */
export class MetaRoutingOwnershipHandler implements EventHandler {
  constructor(
    private readonly routing: MetaRoutingControl,
    private readonly thisMetaAppId: string
  ) {
    if (!/^[0-9]{6,30}$/u.test(thisMetaAppId)) {
      throw new Error("Meta routing requires a valid application ID");
    }
  }

  canHandle(stored: StoredInboundEvent): boolean {
    const event = stored.event;
    return event.provider === "meta"
      && (event.channel === "messenger" || event.channel === "instagram")
      && event.capability === "routing"
      && (event.eventType.startsWith("standby.")
        || event.eventType === "handover.pass"
        || event.eventType === "handover.take");
  }

  async handle(stored: StoredInboundEvent): Promise<EventHandlingResult> {
    const event = stored.event;
    // An event without a verified customer identity cannot affect ownership.
    if (event.identityId === undefined || event.identityId.length === 0) {
      return { actions: [], outcome: "ignored" };
    }

    // Use signed provider time for precedence. If it is missing, a signed
    // ingress timestamp is safer than allowing an unverified takeover.
    const occurredAt = event.occurredAt ?? event.receivedAt;
    if (event.eventType.startsWith("standby.")) {
      await this.routing.blockNativeRouting(stored.partitionKey, occurredAt);
      return { actions: [], outcome: "handled" };
    }

    if (event.eventType === "handover.pass" || event.eventType === "handover.take") {
      const data = event.data;
      const envelope = typeof data === "object" && data !== null && !Array.isArray(data)
        ? data as Record<string, unknown> : {};
      const item = typeof envelope.item === "object" && envelope.item !== null
        && !Array.isArray(envelope.item) ? envelope.item as Record<string, unknown> : {};
      const field = event.eventType === "handover.pass"
        ? "pass_thread_control" : "take_thread_control";
      const raw = item[field];
      const details = typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const owner = details.new_owner_app_id;
      const isThisAppOwner = (typeof owner === "string" || typeof owner === "number")
        && String(owner) === this.thisMetaAppId;
      if (isThisAppOwner) {
        await this.routing.releaseNativeRouting(stored.partitionKey, occurredAt);
      } else {
        // Missing, other, or malformed owner never grants our AI thread control.
        await this.routing.blockNativeRouting(stored.partitionKey, occurredAt);
      }
      return { actions: [], outcome: "handled" };
    }

    return { actions: [], outcome: "ignored" };
  }
}
