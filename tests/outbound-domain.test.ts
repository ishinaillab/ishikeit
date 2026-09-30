import { describe, expect, it } from "vitest";
import type { ActionEnvelope } from "../src/domain/actions.js";
import { actionEnvelopeSchema, actionJobId, conversationOrderingKey } from "../src/domain/actions.js";

function action(idempotencyKey: string): ActionEnvelope {
  return {
    schemaVersion: 1,
    idempotencyKey,
    provider: "telegram",
    capability: "messaging",
    operation: "message.send",
    orderingKey: "conversation-key",
    target: { channel: "bot", accountId: "bot-1", recipientId: "chat-1" },
    body: { part: { kind: "text", text: "hello" } }
  };
}

describe("generic action identities", () => {
  it("derives stable UUID-shaped job IDs without provider-specific core code", () => {
    const first = actionJobId(action("reply:event-1"));
    const second = actionJobId(action("reply:event-1"));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes the job identity when the logical action changes", () => {
    expect(actionJobId(action("reply:event-1"))).not.toBe(actionJobId(action("reply:event-2")));
  });

  it("accepts future provider capability and operation values", () => {
    expect(actionEnvelopeSchema.safeParse({
      ...action("campaign-1"),
      provider: "meta",
      capability: "marketing",
      operation: "campaign.create",
      target: { adAccountId: "act-1" },
      body: { name: "Future campaign" }
    }).success).toBe(true);
  });

  it("derives provider-neutral conversation ordering keys", () => {
    const first = conversationOrderingKey({
      provider: "telegram",
      channel: "bot",
      accountId: "bot-1",
      identityId: "chat-1"
    });
    const second = conversationOrderingKey({
      provider: "telegram",
      channel: "bot",
      accountId: "bot-1",
      identityId: "chat-1"
    });
    expect(first).toBe(second);
  });
});
