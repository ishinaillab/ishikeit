import type { StoredInboundEvent } from "../persistence/inbound.js";
import type { EventHandlingResult } from "../domain/processing.js";

export interface EventHandler {
  canHandle(event: StoredInboundEvent): boolean;
  handle(event: StoredInboundEvent): Promise<EventHandlingResult>;
}

export class EventHandlerRegistry {
  readonly #handlers: EventHandler[] = [];

  register(handler: EventHandler): void {
    this.#handlers.push(handler);
  }

  async handle(event: StoredInboundEvent): Promise<EventHandlingResult> {
    const handler = this.#handlers.find((candidate) => candidate.canHandle(event));
    return handler === undefined
      ? { actions: [], outcome: "ignored" }
      : handler.handle(event);
  }
}
