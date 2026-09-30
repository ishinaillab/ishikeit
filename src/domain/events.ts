import { z } from "zod";
import { contentPartSchema } from "./content.js";

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const canonicalEventSchema = z.object({
  schemaVersion: z.literal(2),
  specversion: z.literal("1.0"),
  id: z.string().min(1).max(1024),
  source: z.string().min(1).max(2048),
  type: z.string().min(1).max(512),
  provider: identifierSchema,
  channel: identifierSchema,
  capability: identifierSchema,
  accountId: z.string().min(1).max(1024),
  eventType: z.string().min(1).max(256),
  providerEventId: z.string().min(1).max(2048).optional(),
  providerMessageId: z.string().min(1).max(2048).optional(),
  identityId: z.string().min(1).max(2048).optional(),
  occurredAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime(),
  content: z.array(contentPartSchema).max(64),
  data: z.unknown()
}).strict();

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;

export interface IngressIdentity {
  deduplicationKey: string;
  partitionKey: string;
}
