import type { ContentPart } from "../domain/content.js";
import type { CanonicalEvent } from "../domain/events.js";

export interface BrainTurnRequest {
  turnId: string;
  conversationId: string;
  event: CanonicalEvent;
  input: readonly ContentPart[];
}

export interface BrainTurnResponse {
  parts: ContentPart[];
  handoff: boolean;
  handoffReason?: string;
}

export interface BrainClient {
  respond(request: BrainTurnRequest): Promise<BrainTurnResponse>;
}
