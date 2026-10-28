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

    if (event.eventType.startsWith("standby.") || event.eventType === "handover.take") {
      await this.routing.blockNativeRouting(stored.partitionKey);
      return { actions: [], outcome: "handled" };
    }

    if (event.eventType === "handover.pass") {
      const data = event.data;
      const envelope = typeof data === "object" && data !== null && !Array.isArray(data)
        ? data as Record<string, unknown> : {};
      const item = typeof envelope.item === "object" && envelope.item !== null
        && !Array.isArray(envelope.item) ? envelope.item as Record<string, unknown> : {};
      const pass = typeof item.pass_thread_control === "object"
        && item.pass_thread_control !== null && !Array.isArray(item.pass_thread_control)
        ? item.pass_thread_control as Record<string, unknown> : {};
      const owner = pass.new_owner_app_id;
      if (typeof owner === "string" && owner === this.thisMetaAppId
        || typeof owner === "number" && String(owner) === this.thisMetaAppId) {
        await this.routing.releaseNativeRouting(stored.partitionKey);
      } else {
        // Missing/other owner does not authorize Ishikeit to respond.
        await this.routing.blockNativeRouting(stored.partitionKey);
      }
      return { actions: [], outcome: "handled" };
    }

    return { actions: [], outcome: "ignored" };
  }
}
