import { createHash } from "node:crypto";
import { z } from "zod";

export const metaOutboundPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(1).max(256),
  channel: z.enum(["messenger", "instagram", "whatsapp"]),
  accountId: z.string().min(1),
  recipientId: z.string().min(1),
  message: z.object({
    type: z.literal("text"),
    text: z.string().min(1)
  }).strict()
}).strict();

export type MetaOutboundPayload = z.infer<typeof metaOutboundPayloadSchema>;

export interface MetaSendResult {
  providerMessageId?: string;
}

export function outboundPartitionKey(payload: MetaOutboundPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(["outbound-conversation-v1", payload.channel, payload.accountId, payload.recipientId]))
    .digest("hex");
}

export function outboundJobId(payload: MetaOutboundPayload): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([
      "meta-message-send-v1",
      payload.idempotencyKey,
      payload.channel,
      payload.accountId,
      payload.recipientId
    ]))
    .digest("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "8" + hex.slice(13, 16),
    "a" + hex.slice(17, 20),
    hex.slice(20, 32)
  ].join("-");
}
