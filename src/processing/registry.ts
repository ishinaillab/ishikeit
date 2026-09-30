import type { ActionEnvelope } from "../domain/actions.js";
import type { StoredInboundEvent } from "../persistence/inbound.js";

export interface EventHandler {
  canHandle(event: StoredInboundEvent): boolean;
  handle(event: StoredInboundEvent): Promise<ActionEnvelope[]>;
}

export class EventHandlerRegistry {
  readonly #handlers: EventHandler[] = [];

  register(handler: EventHandler): void {
    this.#handlers.push(handler);
  }

  async handle(event: StoredInboundEvent): Promise<ActionEnvelope[]> {
    const handler = this.#handlers.find((candidate) => candidate.canHandle(event));
    return handler === undefined ? [] : handler.handle(event);
  }
}
