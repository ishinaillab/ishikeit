import { createHash } from "node:crypto";
import { z } from "zod";

export const metaOutboundPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.enum(["messenger", "instagram"]),
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
