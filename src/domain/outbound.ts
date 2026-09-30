import { z } from "zod";
import { contentPartSchema } from "./content.js";

export const metaOutboundPayloadSchema = z.object({
  schemaVersion: z.literal(2),
  channel: z.enum(["messenger", "instagram", "whatsapp"]),
  accountId: z.string().min(1),
  recipientId: z.string().min(1),
  message: contentPartSchema,
  replyTo: z.string().min(1).optional()
}).strict();

export type MetaOutboundPayload = z.infer<typeof metaOutboundPayloadSchema>;

export interface MetaSendResult {
  providerMessageId?: string;
}
