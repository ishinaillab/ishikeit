import { createHash } from "node:crypto";
import { z } from "zod";
import { contentPartSchema } from "./content.js";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const actionEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(1).max(512),
  provider: identifierSchema,
  capability: identifierSchema,
  operation: identifierSchema,
  orderingKey: z.string().min(1).max(512),
  target: z.record(z.string(), z.unknown()),
  body: z.unknown()
}).strict();

export type ActionEnvelope = z.infer<typeof actionEnvelopeSchema>;

export const messageSendBodySchema = z.object({
  part: contentPartSchema,
  replyTo: z.string().min(1).max(2048).optional()
}).strict();

export type MessageSendBody = z.infer<typeof messageSendBodySchema>;

export interface ActionResult {
  providerResourceId?: string;
  data?: unknown;
}

export function actionJobId(action: ActionEnvelope): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([
      "action-dispatch-v1",
      action.provider,
      action.capability,
      action.operation,
      action.idempotencyKey
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

export function conversationOrderingKey(parts: {
  provider: string;
  channel: string;
  accountId: string;
  identityId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(["conversation-v2", parts.provider, parts.channel, parts.accountId, parts.identityId]))
    .digest("hex");
}
