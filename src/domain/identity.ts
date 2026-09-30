import { createHash } from "node:crypto";
import type { CanonicalEvent, IngressIdentity } from "./events.js";

function hash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function canonicalIngressIdentity(event: CanonicalEvent): IngressIdentity {
  return {
    deduplicationKey: hash(["event-v2", event.source, event.id]),
    partitionKey: hash([
      "conversation-v2",
      event.provider,
      event.channel,
      event.accountId,
      event.identityId ?? event.providerMessageId ?? "account"
    ])
  };
}
