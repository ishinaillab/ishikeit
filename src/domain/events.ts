export type Channel = "messenger" | "instagram" | "whatsapp";

export interface CanonicalEvent {
  schemaVersion: 1;
  channel: Channel;
  accountId: string;
  eventType: string;
  providerEventId?: string;
  providerMessageId?: string;
  identityId?: string;
  occurredAt?: string;
  receivedAt: string;
  payload: unknown;
}

export interface IngressIdentity {
  deduplicationKey: string;
  partitionKey: string;
}
