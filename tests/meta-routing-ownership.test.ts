import { describe, expect, it, vi } from "vitest";
import { MetaRoutingOwnershipHandler } from "../src/processing/meta-routing-ownership-handler.js";
import type { StoredInboundEvent } from "../src/persistence/inbound.js";
import type { MetaRoutingControl } from "../src/persistence/meta-handoff.js";

const event: StoredInboundEvent = {
  id: "event-1",
  partitionKey: "a".repeat(64),
  status: "persisted",
  event: {
    schemaVersion: 2,
    specversion: "1.0",
    id: "routing-event-1",
    source: "urn:ishikeit:source:meta:instagram:ig-1",
    type: "com.ishikeit.routing.standby.message",
    provider: "meta",
    channel: "instagram",
    capability: "routing",
    accountId: "ig-1",
    identityId: "customer-1",
    eventType: "standby.message",
    occurredAt: "2026-10-28T10:59:00.000Z",
    receivedAt: "2026-10-28T10:59:01.000Z",
    content: [],
    data: { routing: "standby", item: {} }
  }
};

function harness() {
  const blockNativeRouting = vi.fn<MetaRoutingControl["blockNativeRouting"]>().mockResolvedValue(undefined);
  const releaseNativeRouting = vi.fn<MetaRoutingControl["releaseNativeRouting"]>().mockResolvedValue(undefined);
  const handler = new MetaRoutingOwnershipHandler({ blockNativeRouting, releaseNativeRouting }, "1042452472116584");
  return { blockNativeRouting, releaseNativeRouting, handler };
}

describe("Meta native routing ownership", () => {
  it("blocks customer AI replies for standby and lost ownership events", async () => {
    const h = harness();
    expect(h.handler.canHandle(event)).toBe(true);
    await expect(h.handler.handle(event)).resolves.toMatchObject({ outcome: "handled", actions: [] });
    await expect(h.handler.handle({
      ...event, event: { ...event.event, eventType: "handover.take",
        data: { item: { take_thread_control: { new_owner_app_id: "different-app" } } } }
    })).resolves.toMatchObject({ outcome: "handled" });
    expect(h.blockNativeRouting).toHaveBeenCalledTimes(2);
    expect(h.blockNativeRouting).toHaveBeenCalledWith("a".repeat(64), "2026-10-28T10:59:00.000Z");
    expect(h.releaseNativeRouting).not.toHaveBeenCalled();
  });

  it("releases native routing only when pass_thread_control gives THIS app ownership", async () => {
    const h = harness();
    const pass = {
      ...event,
      event: {
        ...event.event,
        eventType: "handover.pass",
        data: { item: { pass_thread_control: { previous_owner_app_id: "222", new_owner_app_id: "1042452472116584" } } }
      }
    };
    await expect(h.handler.handle(pass)).resolves.toMatchObject({ outcome: "handled" });
    expect(h.releaseNativeRouting).toHaveBeenCalledWith("a".repeat(64), "2026-10-28T10:59:00.000Z");
    expect(h.blockNativeRouting).not.toHaveBeenCalled();
  });

  it("blocks unknown and other-app ownership rather than assuming Ishikeit regained control", async () => {
    const h = harness();
    for (const owner of ["333", undefined]) {
      await expect(h.handler.handle({
        ...event,
        event: {
          ...event.event,
          eventType: "handover.pass",
          data: { item: { pass_thread_control: { new_owner_app_id: owner } } }
        }
      })).resolves.toMatchObject({ outcome: "handled" });
    }
    expect(h.blockNativeRouting).toHaveBeenCalledTimes(2);
    expect(h.releaseNativeRouting).not.toHaveBeenCalled();
  });

  it("releases ownership on take_thread_control only when it gives this app control", async () => {
    const h = harness();
    await expect(h.handler.handle({
      ...event,
      event: { ...event.event, eventType: "handover.take",
        data: { item: { take_thread_control: {
          previous_owner_app_id: "999", new_owner_app_id: "1042452472116584"
        } } }
      }
    })).resolves.toMatchObject({ outcome: "handled" });
    expect(h.releaseNativeRouting).toHaveBeenCalledWith("a".repeat(64), "2026-10-28T10:59:00.000Z");
    expect(h.blockNativeRouting).not.toHaveBeenCalled();
  });

  it("uses the ingress timestamp to block a callback that lacks provider event time", async () => {
    const h = harness();
    await h.handler.handle({ ...event, event: {
      ...event.event, occurredAt: undefined, eventType: "standby.message"
    }});
    expect(h.blockNativeRouting).toHaveBeenCalledWith("a".repeat(64), "2026-10-28T10:59:01.000Z");
  });

  it("ignores routing requests, non-Meta events, and identity-less notices", async () => {
    const h = harness();
    expect(h.handler.canHandle({
      ...event, event: { ...event.event, eventType: "handover.request" }
    })).toBe(false);
    expect(h.handler.canHandle({
      ...event, event: { ...event.event, provider: "tiktok" }
    })).toBe(false);
    await expect(h.handler.handle({
      ...event, event: { ...event.event, identityId: undefined }
    })).resolves.toEqual({ actions: [], outcome: "ignored" });
    expect(h.blockNativeRouting).not.toHaveBeenCalled();
    expect(h.releaseNativeRouting).not.toHaveBeenCalled();
  });
});
