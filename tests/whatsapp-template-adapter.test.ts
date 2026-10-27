import { describe, expect, it, vi } from "vitest";
import { MetaSender } from "../src/channels/meta-send.js";
import { WhatsAppTemplateAdapter } from "../src/adapters/meta/whatsapp-template.js";
import type { ActionEnvelope } from "../src/domain/actions.js";

const action: ActionEnvelope = {
  schemaVersion: 1, idempotencyKey: "template-1", provider: "meta",
  capability: "messaging", operation: "message.template.send", orderingKey: "thread-1",
  target: { channel: "whatsapp", accountId: "123456789012", recipientId: "639123456789" },
  body: { templateName: "hello_world", languageCode: "en_US", bodyParameters: [] }
};

describe("WhatsApp template adapter", () => {
  it("posts an explicit template request without following redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.example" }] }), { status: 200 }));
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new WhatsAppTemplateAdapter(sender);
    await expect(adapter.execute(action)).resolves.toEqual({ providerResourceId: "wamid.example" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/123456789012/messages");
    expect(init?.redirect).toBe("error");
    if (typeof init?.body !== "string") throw new Error("expected JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({ type: "template", template: { name: "hello_world", language: { code: "en_US" } } });
  });
  it("rejects invalid target and unapproved content shape before network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sender = new MetaSender({ graphApiVersion: "v26.0", whatsappAccessToken: "test-token", instagramGraphHost: "graph.instagram.com", fetchImpl });
    const adapter = new WhatsAppTemplateAdapter(sender);
    await expect(adapter.execute({ ...action, target: { ...action.target, channel: "messenger" } })).rejects.toMatchObject({ retryable: false });
    await expect(adapter.execute({ ...action, body: { templateName: "BAD NAME", languageCode: "en_US" } })).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
