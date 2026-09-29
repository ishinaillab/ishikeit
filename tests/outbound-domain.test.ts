import { describe, expect, it } from "vitest";
import type { MetaOutboundPayload } from "../src/domain/outbound.js";
import { outboundJobId, outboundPartitionKey } from "../src/domain/outbound.js";

function payload(idempotencyKey: string): MetaOutboundPayload {
  return {
    schemaVersion: 1,
    idempotencyKey,
    channel: "instagram",
    accountId: "ig-1",
    recipientId: "user-1",
    message: { type: "text", text: "hello" }
  };
}

describe("outbound identities", () => {
  it("derives a stable UUID-shaped job ID from the logical send identity", () => {
    const first = outboundJobId(payload("reply:event-1"));
    const second = outboundJobId(payload("reply:event-1"));

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes the job ID when the idempotency key changes", () => {
    expect(outboundJobId(payload("reply:event-1"))).not.toBe(outboundJobId(payload("reply:event-2")));
  });

  it("keeps the conversation partition stable across logical sends", () => {
    expect(outboundPartitionKey(payload("reply:event-1"))).toBe(outboundPartitionKey(payload("reply:event-2")));
  });
});
